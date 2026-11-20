import type { Api, Anomalie, Profil, Tache } from "../types";
import type { Operation } from "../operations";

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
  friteuses: () => attendre([{ id: "f1", nom: "Friteuse 1", litres: 25 }, { id: "f2", nom: "Friteuse 2", litres: 25 }]),
  seuilsHuile: () => attendre({ orange: 20, rouge: 25 }),
  fournisseurs: () => attendre(["Transgourmet", "Pomona", "Metro", "Brake", "Boucherie (viandes)", "Boulangerie"].map((nom, i) => ({ id: `f${i}`, nom }))),
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
      case "releves": case "huile":
        op.lignes.forEach((l) => nouveau(l.id));
        terminer(op.tache_id);   // comme le vrai serveur : la saisie clôt la tâche
        break;
      case "livraison": if (nouveau(op.id)) recuDemo.livraisons++; break;
      case "utilisation": if (nouveau(op.id)) recuDemo.utilisations++; break;
      case "livraison_rangee": break;
    }
  },
};
