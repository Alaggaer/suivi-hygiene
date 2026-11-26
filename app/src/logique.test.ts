import { describe, expect, it } from "vitest";
import {
  BORNES_HUILE, bornesReleve, temperaturesDemandees, trierFournisseurs, verdictLivraison, cheminPhoto, dansBornes, etatAvecEnAttente, etatTache, jourHuile, MIN, niveauAgeHuile, niveauEscalade, niveauHuile, service, tachesALheure,
  temperatureConforme, temperaturesLivraisonOk, trierTaches, lectureConforme, actionEnRetard,
} from "./logique";

const T0 = Date.parse("2026-11-20T10:00:00Z"); // 11:00 à Paris
const iso = (ms: number) => new Date(ms).toISOString();

describe("tâches du jour", () => {
  it("donne l'état selon l'échéance", () => {
    expect(etatTache({ echeance: iso(T0 - MIN), faite_at: null }, T0)).toBe("retard");
    expect(etatTache({ echeance: iso(T0 + 15 * MIN), faite_at: null }, T0)).toBe("bientot");
    expect(etatTache({ echeance: iso(T0 + 16 * MIN), faite_at: null }, T0)).toBe("avenir");
    expect(etatTache({ echeance: iso(T0 - MIN), faite_at: iso(T0) }, T0)).toBe("faite");
  });
  it("trie retards, proches, à venir, faites", () => {
    const l = trierTaches([
      { id: "faite", echeance: iso(T0 - 90 * MIN), faite_at: iso(T0) },
      { id: "avenir", echeance: iso(T0 + 60 * MIN), faite_at: null },
      { id: "retard", echeance: iso(T0 - 5 * MIN), faite_at: null },
      { id: "bientot", echeance: iso(T0 + 5 * MIN), faite_at: null },
    ], T0);
    expect(l.map((t) => t.id)).toEqual(["retard", "bientot", "avenir", "faite"]);
  });
  it("relance le chef à 30 min et le responsable à 2 h", () => {
    expect(niveauEscalade(29 * MIN)).toBe("aucune");
    expect(niveauEscalade(30 * MIN)).toBe("chef");
    expect(niveauEscalade(120 * MIN)).toBe("responsable");
  });
  it("compte les tâches faites à l'heure seulement", () => {
    expect(tachesALheure([
      { echeance: iso(T0), faite_at: iso(T0 - MIN) },
      { echeance: iso(T0), faite_at: iso(T0 + MIN) },
      { echeance: iso(T0), faite_at: null },
    ])).toBe(1);
  });
});

describe("seuils", () => {
  it("températures positives et négatives", () => {
    expect(temperatureConforme(3, 3)).toBe(true);
    expect(temperatureConforme(3.1, 3)).toBe(false);
    expect(temperatureConforme(-20, -18)).toBe(true);
    expect(temperatureConforme(-15, -18)).toBe(false);
  });
  it("huile : compteur de jours de la même huile", () => {
    const e = (j: number, at: string | null = null, off: boolean | null = null) => ({ jours_utilisation: j, aujourd_hui_at: at, aujourd_hui_non_utilisee: off });
    expect(jourHuile(undefined)).toBe(1);
    expect(jourHuile(e(5))).toBe(6);                       // pas encore saisie aujourd'hui : aujourd'hui sera le 6e jour
    expect(jourHuile(e(6, "2026-11-20T10:00:00Z"))).toBe(6); // déjà saisie aujourd'hui : déjà comptée
    expect(jourHuile(e(5, "2026-11-20T10:00:00Z", true))).toBe(6); // marquée non utilisée puis finalement utilisée
    expect(jourHuile(e(0))).toBe(1);
    expect(niveauAgeHuile(12)).toBe("ok");
    expect(niveauAgeHuile(13)).toBe("warn");
    expect(niveauAgeHuile(14)).toBe("warn");               // 14e jour : encore autorisé, dernier jour
    expect(niveauAgeHuile(15)).toBe("bad");                // au-delà de 14 j : changement obligatoire
    expect(niveauAgeHuile(8, 7)).toBe("bad");              // réglage siège différent
  });
  it("huile : les mesures en attente d'envoi comptent, sans double compte", () => {
    const base = [
      { friteuse_id: "a", jours_utilisation: 5, dernier_changement: null, aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null },
      { friteuse_id: "b", jours_utilisation: 15, dernier_changement: null, aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null },
      { friteuse_id: "c", jours_utilisation: 2, dernier_changement: null, aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null },
    ];
    const maintenant = new Date().toISOString();
    const op = (lignes: object[], at_client = maintenant) => ({ type: "huile", at_client, lignes });
    const r = etatAvecEnAttente(base, [
      op([{ friteuse_id: "a", polaires: 12, changement: false }]),
      op([{ friteuse_id: "a", polaires: 13, changement: false }]),          // 2e mesure le même jour : pas de double compte
      op([{ friteuse_id: "b", polaires: 10, changement: true }]),
      // Changement fait il y a 3 jours, encore en attente (file bloquée) : le compteur repart de là, sans compter comme mesure du jour.
      op([{ friteuse_id: "c", polaires: 30, changement: true }], new Date(Date.now() - 3 * 86400000).toISOString()),
      op([{ friteuse_id: "c", polaires: null, changement: false, non_utilisee: true }]),
      { type: "releves", at_client: "2026-11-20T10:00:00Z" },
    ]);
    expect(r.map((e) => e.jours_utilisation)).toEqual([6, 1, 1]);
    expect(r[0].aujourd_hui_polaires).toBe(13);
    expect(r[2].aujourd_hui_non_utilisee).toBe(true);
    expect(base[0].jours_utilisation).toBe(5);                               // l'état serveur n'est pas modifié
  });
  it("huile : vert, orange, rouge à 25 %", () => {
    const s = { orange: 20, rouge: 25 };
    expect(niveauHuile(19.5, s)).toBe("ok");
    expect(niveauHuile(20, s)).toBe("warn");
    expect(niveauHuile(24.9, s)).toBe("warn");
    expect(niveauHuile(25, s)).toBe("bad");
  });
  it("livraison : surgelé facultatif, chaque seuil vérifié", () => {
    expect(temperaturesLivraisonOk({ camion: 3, frais: 4 })).toBe(true);
    expect(temperaturesLivraisonOk({ camion: 5, frais: 2 })).toBe(false);
    expect(temperaturesLivraisonOk({ camion: 2, frais: 2, surgele: -12 })).toBe(false);
    expect(temperaturesLivraisonOk({ camion: 2, frais: 2, surgele: -19 })).toBe(true);
  });
});

describe("heure de Paris", () => {
  it("service midi / soir à 16 h heure de Paris, été comme hiver", () => {
    expect(service(Date.parse("2026-11-20T14:59:00Z"))).toBe("midi");  // 15:59 Paris (hiver)
    expect(service(Date.parse("2026-11-20T15:00:00Z"))).toBe("soir");  // 16:00 Paris
    expect(service(Date.parse("2026-07-01T13:59:00Z"))).toBe("midi");  // 15:59 Paris (été)
    expect(service(Date.parse("2026-07-01T14:00:00Z"))).toBe("soir");
  });
  it("range les photos par site et par jour de Paris", () => {
    expect(cheminPhoto("site-1", "abc", Date.parse("2026-11-20T23:30:00Z"))).toBe("site-1/2026-11-21/abc.webp");
  });
});

import { minuteurConforme, transitionPermise } from "./logique";
describe("minuteurs de cuisine", () => {
  it("refroidissement : sous +10 °C en 2 h au plus", () => {
    expect(minuteurConforme("refroidissement", 8, 110 * MIN)).toBe(true);
    expect(minuteurConforme("refroidissement", 10, 110 * MIN)).toBe(false);
    expect(minuteurConforme("refroidissement", 5, 121 * MIN)).toBe(false);
  });
  it("remise en température : +63 °C en 1 h au plus", () => {
    expect(minuteurConforme("remise_temperature", 63, 55 * MIN)).toBe(true);
    expect(minuteurConforme("remise_temperature", 60, 55 * MIN)).toBe(false);
    expect(minuteurConforme("remise_temperature", 70, 61 * MIN)).toBe(false);
  });
});
describe("cycle des anomalies", () => {
  it("tout le monde peut traiter, seuls chef / responsable / siège vérifient", () => {
    expect(transitionPermise("ouverte", "traitee", "equipe")).toBe(true);
    expect(transitionPermise("traitee", "verifiee", "equipe")).toBe(false);
    expect(transitionPermise("traitee", "verifiee", "chef")).toBe(true);
    expect(transitionPermise("ouverte", "verifiee", "siege")).toBe(false);
    expect(transitionPermise("verifiee", "ouverte", "siege")).toBe(false);
  });
});

import { scoreSite, tauxALheure } from "./logique";
describe("tableau du siège", () => {
  const ok = { taches_total: 20, taches_a_lheure: 20, taches_non_faites: 0, anomalies_ouvertes: 0, anomalies_critiques: 0, livraisons_nc: 0, huile_rouges: 0 };
  it("taux à l'heure, sans division par zéro", () => {
    expect(tauxALheure({ taches_total: 20, taches_a_lheure: 15 })).toBe(0.75);
    expect(tauxALheure({ taches_total: 0, taches_a_lheure: 0 })).toBeNull();
  });
  it("une anomalie critique pèse plus qu'un léger retard", () => {
    expect(scoreSite(ok)).toBe(0);
    expect(scoreSite({ ...ok, anomalies_critiques: 1, anomalies_ouvertes: 1 })).toBeGreaterThan(scoreSite({ ...ok, taches_a_lheure: 18 }));
  });
});

describe("valeurs vraisemblables", () => {
  it("enceinte positive : −4 °C refusé, −3 et +20 acceptés", () => {
    const b = bornesReleve(4);
    expect(dansBornes(-4, b)).toBe(false);
    expect(dansBornes(-3, b) && dansBornes(20, b) && dansBornes(3.5, b)).toBe(true);
    expect(dansBornes(21, b)).toBe(false);
  });
  it("enceinte négative : +18 °C refusé (signe oublié), −18 accepté", () => {
    const b = bornesReleve(-18);
    expect(dansBornes(18, b)).toBe(false);
    expect(dansBornes(-18, b) && dansBornes(-12, b) && dansBornes(4, b)).toBe(true);
  });
  it("huile entre 0 et 40 %", () => {
    expect(dansBornes(41, BORNES_HUILE)).toBe(false);
    expect(dansBornes(24.5, BORNES_HUILE)).toBe(true);
  });
});

describe("réception de livraison", () => {
  const base = { problemes: [] as string[], viande: false, origine: null };
  it("verdict calculé : conforme seulement si tout est dans les seuils et rien n'est signalé", () => {
    expect(verdictLivraison({ ...base, camion: 2.5, frais: 3 })).toEqual({ conforme: true, motifs: [], graveTemperature: false });
    expect(verdictLivraison({ ...base, camion: 9, frais: 3 })).toEqual({ conforme: false, motifs: ["Température"], graveTemperature: true });
    expect(verdictLivraison({ ...base, camion: 2, surgele: -12 }).conforme).toBe(false);
    expect(verdictLivraison({ ...base, camion: 2, problemes: ["DLC trop courte"] })).toEqual({ conforme: false, motifs: ["DLC trop courte"], graveTemperature: false });
    expect(verdictLivraison({ camion: 2, problemes: [], viande: true, origine: false }).motifs).toEqual(["Origine viande absente"]);
    expect(verdictLivraison({ camion: 2, problemes: [], viande: false, origine: false }).conforme).toBe(true);
  });
  it("températures demandées selon ce que livre le fournisseur", () => {
    expect(temperaturesDemandees(null)).toEqual({ frais: true, surgele: true });
    expect(temperaturesDemandees(["sec"])).toEqual({ frais: false, surgele: false });
    expect(temperaturesDemandees(["frais", "surgele"])).toEqual({ frais: true, surgele: true });
    expect(temperaturesDemandees(["surgele"])).toEqual({ frais: false, surgele: true });
  });
  it("fournisseurs attendus aujourd'hui en premier", () => {
    const samedi = new Date("2026-11-21T09:00:00");
    const l = trierFournisseurs([{ nom: "B", jours: [1] }, { nom: "A", jours: [] }, { nom: "C", jours: [6] }], samedi);
    expect(l.map((f) => `${f.nom}${f.attendu ? "*" : ""}`)).toEqual(["C*", "A", "B"]);
  });
});

describe("Espace PMS", () => {
  it("clôture (choix B) : le chef clôt le quotidien ; écart PMS majeur et action critique par le siège", () => {
    expect(transitionPermise("traitee", "verifiee", "chef", "mineure", "controle")).toBe(true);
    expect(transitionPermise("traitee", "verifiee", "equipe", "mineure")).toBe(false);
    expect(transitionPermise("traitee", "verifiee", "chef", "majeure", "tache")).toBe(true);
    expect(transitionPermise("traitee", "verifiee", "responsable", "majeure", "releve")).toBe(true);
    for (const src of ["controle", "metrologie", "visite", "analyse"]) expect(transitionPermise("traitee", "verifiee", "responsable", "majeure", src)).toBe(false);
    expect(transitionPermise("traitee", "verifiee", "chef", "critique", "releve")).toBe(false);
    expect(transitionPermise("traitee", "verifiee", "siege", "critique", "visite")).toBe(true);
  });
  it("sondes : tolérances glace fondante et eau bouillante", () => {
    expect(lectureConforme("glace", 0.5)).toBe(true);
    expect(lectureConforme("glace", -0.8)).toBe(true);    // classeur : entre −1 et +1 °C
    expect(lectureConforme("glace", 1)).toBe(false);
    expect(lectureConforme("glace", -1.2)).toBe(false);
    expect(lectureConforme("ebullition", 99)).toBe(true);
    expect(lectureConforme("ebullition", 101.5)).toBe(false);
  });
  it("action en retard : échéance passée et pas encore corrigée", () => {
    expect(actionEnRetard({ statut: "ouverte", echeance: "2026-11-20" }, "2026-11-22")).toBe(true);
    expect(actionEnRetard({ statut: "ouverte", echeance: "2026-11-22" }, "2026-11-22")).toBe(false);
    expect(actionEnRetard({ statut: "traitee", echeance: "2026-11-20" }, "2026-11-22")).toBe(false);
    expect(actionEnRetard({ statut: "ouverte", echeance: null }, "2026-11-22")).toBe(false);
  });
});

describe("vérification de sonde", () => {
  it("refuse une valeur impossible avant l'envoi (comme le serveur)", async () => {
    const { lecturePlausible } = await import("./logique");
    expect(lecturePlausible("glace", 0.2)).toBe(true);
    expect(lecturePlausible("ebullition", 99.6)).toBe(true);
    expect(lecturePlausible("ebullition", 996)).toBe(false);
    expect(lecturePlausible("glace", 25)).toBe(false);
  });
});


describe("réception : seuils par famille (classeur du groupe)", () => {
  it("poisson 0/+2, viande 0/+3, laitiers 0/+4, légumes +1/+8", async () => {
    const { verdictLivraison, famillesAMesurer } = await import("./logique");
    const v = (produits: Record<string, number>) => verdictLivraison({ camion: 2, produits, problemes: [], viande: false, origine: null }).conforme;
    expect(v({ poisson: 2 })).toBe(true);
    expect(v({ poisson: 3 })).toBe(false);
    expect(v({ viande: 3.5 })).toBe(false);
    expect(v({ legumes: 6 })).toBe(true);
    expect(v({ legumes: 0.5 })).toBe(false);
    expect(v({ bof: -1 })).toBe(false);
    expect(famillesAMesurer({ produits: ["frais"], familles: ["poisson"] })).toEqual(["poisson"]);
    expect(famillesAMesurer({ produits: ["frais"] })).toEqual(["bof", "poisson", "viande", "legumes"]);
    expect(famillesAMesurer({ produits: ["sec"] })).toEqual([]);
  });
});
