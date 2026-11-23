import { describe, expect, it } from "vitest";
import type { Api } from "../types";
import { avecCache, type Memoire } from "./cache";

function memoire(): Memoire { const m = new Map<string, string>(); return { get: (c) => m.get(c) ?? null, set: (c, v) => void m.set(c, v) }; }

function faux(): Api & { reseau: boolean } {
  const etat = { reseau: true };
  const panne = () => { if (!etat.reseau) throw new TypeError("Failed to fetch"); };
  return Object.assign(etat, {
    mode: "demo" as const,
    estActivee: async () => true, activer: async () => {},
    site: async () => { panne(); return { id: "s1", nom: "DALLAS", ville: "CHAMBRAY" }; },
    profils: async () => { panne(); return [{ id: "p1", nom: "Karim", role: "chef" as const }]; },
    verifierPin: async (_id: string, pin: string) => { panne(); return pin === "1234"; },
    taches: async () => { panne(); return []; },
    enceintes: async () => { panne(); return [{ id: "e1", nom: "CF+", t_max: 3 }]; },
    friteuses: async () => { panne(); return []; },
    seuilsHuile: async () => { panne(); return { orange: 20, rouge: 25 }; },
    etatFriteuses: async () => { panne(); return []; },
    fournisseurs: async () => { panne(); return []; },
    anomaliesOuvertes: async () => { panne(); return []; },
    executer: async () => {}, televerserPhoto: async () => {},
    estSiege: async () => false, tableauSiege: async () => [], fournisseursNonConformes: async () => [],
    anomaliesSiege: async () => [], siegeCorriger: async () => {}, siegeRattraper: async () => {}, equipementsSite: async () => ({ enceintes: [], friteuses: [] }), etatRestaurants: async () => [], etatAlertes: async () => ({ ok: true, appels_reussis_1h: 1, appels_en_echec_1h: 0, dernier_appel_reussi: null, dernier_echec: null, planification_en_echec_1h: 0, alertes_non_envoyees: 0, alertes_sans_destinataire: 0 }), livraisonsDuJour: async () => [], stocksMortsDuSite: async () => [], stocksMortsSiege: async () => [],
    siegeRetirerProduit: async () => {}, siegeCloreProduit: async () => {},
    planAction: async () => [], etatControles: async () => [], etatMetrologie: async () => [], ajouterAppareil: async () => {}, pmsGroupe: async () => [], typesDocuments: async () => [], documentsSite: async () => ({ documents: [], attendus: [] }), documentsArchives: async () => [],
    documentsGroupe: async () => [], siegeEnregistrerDocument: async () => {}, siegeArchiverDocument: async () => {}, etatVisites: async () => ({ eurofins_mois: 2, derniere_eurofins: null, prochaine_eurofins: null, etat_eurofins: "jamais" as const, visites: [] }),
    siegeEnregistrerVisite: async () => {}, siegeAjouterAnalyses: async () => {},
    modelesControles: async () => [], siegePlanifierAction: async () => {}, siegeEnregistrerControle: async () => {},
    nettoyageDuJour: async () => [], produitsEntretien: async () => [], planNettoyage: async () => [], nettoyageSiege: async () => [], siegeDeposerDocument: async () => "",
    alertesDuSite: async () => [], alertesSiege: async () => [], siegeCreerAlerte: async () => "", siegeCloreAlerte: async () => {},
    sitesGestion: async () => [], referentielSite: async () => ({ enceintes: [], friteuses: [], modeles: [] }), fournisseursGestion: async () => [],
    siegeEnregistrer: async () => {}, siegeCreerRestaurant: async () => "", employesSite: async () => [], siegeAjouterEmploye: async () => "",
    siegeNouveauPin: async () => "", siegeModifierEmploye: async () => {}, tablettes: async () => [], creerTablette: async () => {}, motDePasseTablette: async () => {}, historiqueSite: async () => [], siegeChangerStatut: async () => {}, urlPhoto: async () => "",
    preuvesJour: async () => ({ taches: [], releves: [], huiles: [], livraisons: [], produits: [], anomalies: [] }),
  });
}

describe("lectures hors ligne", () => {
  it("huile hors ligne le matin : l'âge d'hier est gardé, la mesure d'hier ne compte pas pour aujourd'hui", async () => {
    const m = memoire(), api = faux(), c = avecCache(api, m);
    m.set("suivi-hygiene:cache:etatFriteuses", JSON.stringify({ jour: "2000-01-01", v: [{ friteuse_id: "f1", jours_utilisation: 9, aujourd_hui_at: "x", aujourd_hui_polaires: 20 }] }));
    api.reseau = false;
    expect(await c.etatFriteuses()).toEqual([{ friteuse_id: "f1", jours_utilisation: 9, aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null }]);
  });

  it("tâches du jour : la copie d'hier n'est pas resservie, et une nouvelle activation vide tout", async () => {
    const m = memoire(), api = faux(), c = avecCache(api, m);
    m.set("suivi-hygiene:cache:taches", JSON.stringify({ jour: "2000-01-01", v: [{ id: "vieille" }] }));
    api.reseau = false;
    await expect(c.taches()).rejects.toThrow();
    api.reseau = true; await c.taches(); await c.enceintes();
    api.reseau = false;
    expect(await c.taches()).toEqual([]);
    const vide: string[] = [];
    const m2: Memoire = { ...m, vider: (p) => vide.push(p) };
    await avecCache(api, m2).activer("a@b.fr", "x");
    expect(vide).toEqual(["suivi-hygiene:cache:"]);
  });

  it("ressert la dernière réponse quand le réseau est coupé", async () => {
    const f = faux(), api = avecCache(f, memoire());
    expect(await api.enceintes()).toHaveLength(1);
    f.reseau = false;
    expect(await api.enceintes()).toEqual([{ id: "e1", nom: "CF+", t_max: 3 }]);
  });
  it("sans réponse connue, l'erreur remonte", async () => {
    const f = faux(), api = avecCache(f, memoire());
    f.reseau = false;
    await expect(api.site()).rejects.toThrow();
  });
  it("une erreur du serveur (pas du réseau) n'est pas masquée par le cache", async () => {
    const f = faux(), api = avecCache(f, memoire());
    await api.enceintes();
    f.enceintes = async () => { throw new Error("permission denied for table enceintes"); };
    await expect(avecCache(f, memoire()).enceintes()).rejects.toThrow("permission");
  });
});

describe("PIN hors ligne", () => {
  it("reconnaît la personne hors ligne après une première connexion en ligne", async () => {
    const f = faux(), m = memoire(), api = avecCache(f, m);
    expect(await api.verifierPin("p1", "1234")).toBe(true);
    f.reseau = false;
    expect(await api.verifierPin("p1", "1234")).toBe(true);
    expect(await api.verifierPin("p1", "0000")).toBe(false);
  });
  it("refuse hors ligne une personne jamais connectée sur cette tablette", async () => {
    const f = faux(), api = avecCache(f, memoire());
    f.reseau = false;
    await expect(api.verifierPin("p1", "1234")).rejects.toThrow();
  });
  it("ne garde jamais le PIN en clair", async () => {
    const f = faux(), m = memoire(), api = avecCache(f, m);
    await api.verifierPin("p1", "1234");
    const valeurs: string[] = [];
    const m2: Memoire = { get: m.get, set: (c, v) => { valeurs.push(v); m.set(c, v); } };
    await avecCache(f, m2).verifierPin("p1", "1234");
    expect(valeurs.join()).not.toContain("1234");
  });
});
