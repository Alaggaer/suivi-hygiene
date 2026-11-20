import type { Api, Anomalie, EtatFriteuse, Profil, Tache } from "../types";
import { ErreurDefinitive, type Operation } from "../operations";
import { transitionPermise } from "../logique";

/** Serveur simulé en mémoire : sert au développement et aux démonstrations, rien n'est conservé. */
const MIN = 60_000;
const t0 = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const PINS: Record<string, string> = { p1: "1234", p2: "1111", p3: "2222", p4: "3333" };

const profils: Profil[] = [
  { id: "p1", nom: "Karim", role: "chef" },
  { id: "p2", nom: "Julie", role: "equipe" },
  { id: "p3", nom: "Mehdi", role: "equipe" },
  { id: "p4", nom: "Thomas", role: "responsable" },
];
const taches: Tache[] = [
  { id: "t1", type: "releves", titre: "Relevé températures du matin", echeance: iso(t0 - 25 * MIN), faite_at: null, faite_par_nom: null, escalade: 0 },
  { id: "t2", type: "huile", titre: "Mesure de l'huile", echeance: iso(t0 + 10 * MIN), faite_at: null, faite_par_nom: null, escalade: 0 },
  { id: "t3", type: "dlc", titre: "Tour des DLC", echeance: iso(t0 - 150 * MIN), faite_at: iso(t0 - 140 * MIN), faite_par_nom: "Karim", escalade: 0 },
  { id: "t4", type: "nettoyage", titre: "Nettoyage hottes et filtres", echeance: iso(t0 + 180 * MIN), faite_at: null, faite_par_nom: null, escalade: 0 },
  { id: "t5", type: "releves", titre: "Relevé températures du soir", echeance: iso(t0 + 390 * MIN), faite_at: null, faite_par_nom: null, escalade: 0 },
];
const anomalies: Anomalie[] = [
  { id: "a1", titre: "Joint de porte abîmé · chambre froide positive", categorie: "Matériel", gravite: "mineure", statut: "ouverte", cree_at: iso(t0 - 26 * 60 * MIN) },
];
const SITES_DEMO = [
  ["ATLANTA", "LANGUEUX"], ["BOSTON", "RENNES"], ["COLUMBIA", "BRÉTIGNY-SUR-ORGE"], ["DALLAS", "CHAMBRAY"],
  ["ELVIS AND CO", "TOURS"], ["MIAMI'S", "DIJON"], ["NEW-YORK", "ARRAS"], ["PHILADELPHIE", "LES CLAYES-SOUS-BOIS"],
  ["PHOENIX", "SARAN"], ["SITE 10", "À COMPLÉTER"], ["SITE 11", "À COMPLÉTER"], ["SITE 12", "À COMPLÉTER"],
  ["SITE 13", "À COMPLÉTER"], ["SITE 14", "À COMPLÉTER"], ["SITE 15", "À COMPLÉTER"],
];
/** Huile des friteuses de démo : jours déjà utilisés (F2 bientôt au maximum, F3 au-delà de 14 j). */
const JOUR = 24 * 60 * MIN;
const etatHuile: EtatFriteuse[] = [
  { friteuse_id: "f1", jours_utilisation: 5, dernier_changement: iso(t0 - 5 * JOUR), aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null },
  { friteuse_id: "f2", jours_utilisation: 12, dernier_changement: iso(t0 - 13 * JOUR), aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null },
  { friteuse_id: "f3", jours_utilisation: 14, dernier_changement: iso(t0 - 16 * JOUR), aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null },
  { friteuse_id: "f4", jours_utilisation: 2, dernier_changement: iso(t0 - 3 * JOUR), aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null },
];
/** Ce que le serveur simulé a reçu (identifiants déjà vus : un envoi rejoué est ignoré, comme sur le vrai serveur). */
export const recuDemo = { ids: new Set<string>(), photos: new Map<string, Blob>(), livraisons: 0, utilisations: 0 };
const attendre = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 80));

/** Pour les démonstrations et les tests : simule une coupure réseau (window.__demoHorsLigne = true). */
function horsLigne(): boolean { return typeof window !== "undefined" && (window as unknown as { __demoHorsLigne?: boolean }).__demoHorsLigne === true; }

export const demoApi: Api = {
  mode: "demo",
  estActivee: () => attendre(true),
  activer: async () => {},
  site: () => attendre({ id: "s1", nom: "DALLAS", ville: "CHAMBRAY" }),
  profils: () => attendre(profils),
  verifierPin: (id, pin) => attendre(PINS[id] === pin),
  taches: () => attendre(taches.map((t) => ({ ...t }))),
  enceintes: () => attendre([
    { id: "e1", nom: "Chambre froide positive", t_max: 3 },
    { id: "e2", nom: "Chambre froide négative", t_max: -18 },
    { id: "e3", nom: "Frigo poste chaud", t_max: 4 },
    { id: "e4", nom: "Frigo poste froid", t_max: 4 },
    { id: "e5", nom: "Frigo desserts", t_max: 4 },
    { id: "e6", nom: "Congélateur poste froid", t_max: -18 },
  ]),
  friteuses: () => attendre([1, 2, 3, 4].map((i) => ({ id: `f${i}`, nom: `Friteuse ${i}`, litres: 25 }))),
  seuilsHuile: () => attendre({ orange: 20, rouge: 25, jours_max: 14 }),
  etatFriteuses: () => attendre(etatHuile.map((e) => ({ ...e }))),
  fournisseurs: () => attendre(["Transgourmet", "Pomona", "Metro", "Brake", "Boucherie (viandes)", "Boulangerie"].map((nom, i) => ({ id: `f${i}`, nom }))),
  estSiege: async () => typeof location !== "undefined" && (location.hash === "#siege" || new URLSearchParams(location.search).has("siege")),
  tableauSiege: async (jours) => SITES_DEMO.map((s, i) => {
    // Chiffres d'exemple déterministes (mêmes à chaque chargement), proportionnels à la période.
    const r = (k: number) => ((i * 37 + k * 11) % 17) / 17;
    const f = jours / 7, total = Math.round(70 * f), aLheure = Math.round(total * (0.72 + r(1) * 0.26));
    const ouvertes = Math.round(r(4) * 6), critiques = ouvertes && r(5) > 0.85 ? 1 : 0;
    const mesures = Math.round((12 + r(9) * 2) * f), rouges = Math.min(mesures, r(10) > 0.8 ? Math.ceil(f) : 0);
    return {
      site_id: `s${i}`, nom: s[0], ville: s[1], taches_total: total, taches_a_lheure: aLheure,
      taches_non_faites: Math.round((total - aLheure) * 0.15), anomalies_ouvertes: ouvertes, anomalies_critiques: critiques,
      plus_ancienne_h: ouvertes ? Math.max(1, Math.round(r(6) * 90)) : null,
      livraisons: Math.round((18 + r(7) * 8) * f), livraisons_nc: Math.round(r(8) * 3 * f),
      huile_mesures: mesures, huile_rouges: rouges, huile_max: Math.round((14 + r(11) * 12) * 10) / 10,
    };
  }),
  fournisseursNonConformes: async () => [
    { fournisseur: "Boucherie (viandes)", livraisons: 64, non_conformes: 7 },
    { fournisseur: "Pomona", livraisons: 120, non_conformes: 5 },
    { fournisseur: "Transgourmet", livraisons: 138, non_conformes: 3 },
    { fournisseur: "Metro", livraisons: 42, non_conformes: 1 },
    { fournisseur: "Brake", livraisons: 55, non_conformes: 0 },
  ],
  anomaliesOuvertes: () => attendre(anomalies.filter((a) => a.statut !== "verifiee").map((a) => ({ ...a }))),

  async televerserPhoto(chemin, blob) {
    if (horsLigne()) throw new TypeError("Failed to fetch");
    recuDemo.photos.set(chemin, blob);
  },
  async executer(op: Operation) {
    await attendre(null);
    if (horsLigne()) throw new TypeError("Failed to fetch");
    const nouveau = (id: string) => { if (recuDemo.ids.has(id)) return false; recuDemo.ids.add(id); return true; };
    const terminer = (tacheId?: string) => {
      const t = taches.find((x) => x.id === tacheId);
      if (t && !t.faite_at) { t.faite_at = op.at_client; t.faite_par_nom = op.par_nom; }
    };
    switch (op.type) {
      case "terminer_tache": terminer(op.tache_id); break;
      case "anomalies":
        op.lignes.forEach((a) => {
          if (nouveau(a.id)) anomalies.unshift({ id: a.id, titre: a.titre, categorie: a.categorie, gravite: a.gravite, statut: "ouverte", cree_at: op.at_client });
        });
        break;
      case "releves":
        op.lignes.forEach((l) => nouveau(l.id));
        terminer(op.tache_id);   // comme le vrai serveur : la saisie clôt la tâche
        break;
      case "huile":
        op.lignes.forEach((l) => {
          if (!nouveau(l.id)) return;
          const e = etatHuile.find((x) => x.friteuse_id === l.friteuse_id);
          if (!e) return;
          const dejaCompte = !!e.aujourd_hui_at && !e.aujourd_hui_non_utilisee;
          if (l.changement) { e.jours_utilisation = 1; e.dernier_changement = op.at_client; }
          else if (!l.non_utilisee && !dejaCompte) e.jours_utilisation++;
          e.aujourd_hui_at = op.at_client; e.aujourd_hui_polaires = l.polaires; e.aujourd_hui_non_utilisee = !!l.non_utilisee;
        });
        terminer(op.tache_id);   // la tablette n'envoie la tâche que lorsque toutes les friteuses sont faites
        break;
      case "livraison": if (nouveau(op.id)) recuDemo.livraisons++; break;
      case "utilisation": if (nouveau(op.id)) recuDemo.utilisations++; break;
      case "livraison_rangee": break;
      case "minuteur": nouveau(op.id); break;
      case "anomalie_statut": {
        const a = anomalies.find((x) => x.id === op.anomalie_id);
        const role = profils.find((p) => p.id === op.par)?.role ?? "equipe";
        if (!a) break;
        if (a.statut === op.statut) break;                       // déjà fait (envoi rejoué)
        if (!transitionPermise(a.statut, op.statut, role)) throw new ErreurDefinitive("Changement de statut non autorisé");
        a.statut = op.statut;
        break;
      }
    }
  },
};
