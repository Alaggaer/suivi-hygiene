/** Règles métier pures (sans écran ni serveur) : ce sont elles que les tests unitaires vérifient. */
import type { EtatFriteuse, SeuilsHuile, Tache, Gravite } from "./types";

export const MIN = 60_000;

export type EtatTache = "faite" | "retard" | "bientot" | "avenir";
export function etatTache(t: Pick<Tache, "echeance" | "faite_at">, maintenant: number): EtatTache {
  if (t.faite_at) return "faite";
  const d = Date.parse(t.echeance) - maintenant;
  if (d < 0) return "retard";
  return d <= 15 * MIN ? "bientot" : "avenir";
}
const ORDRE: Record<EtatTache, number> = { retard: 0, bientot: 1, avenir: 2, faite: 3 };
/** Les retards d'abord, puis les échéances proches, puis le reste ; les tâches faites à la fin. */
export function trierTaches<T extends Pick<Tache, "echeance" | "faite_at">>(taches: T[], maintenant: number): T[] {
  return taches.slice().sort((a, b) =>
    ORDRE[etatTache(a, maintenant)] - ORDRE[etatTache(b, maintenant)] || Date.parse(a.echeance) - Date.parse(b.echeance));
}
/** Niveau de relance affiché pour une tâche en retard (le serveur envoie les notifications aux mêmes seuils). */
export function niveauEscalade(retardMs: number): "aucune" | "chef" | "responsable" {
  if (retardMs >= 120 * MIN) return "responsable";
  if (retardMs >= 30 * MIN) return "chef";
  return "aucune";
}
export function tachesALheure(taches: Pick<Tache, "echeance" | "faite_at">[]): number {
  return taches.filter((t) => t.faite_at && Date.parse(t.faite_at) <= Date.parse(t.echeance)).length;
}

/** Une température est conforme si elle ne dépasse pas le maximum (valable aussi pour le négatif : -15 > -18 = hors seuil). */
export const temperatureConforme = (valeur: number, max: number) => valeur <= max;

export type NiveauHuile = "ok" | "warn" | "bad";
export function niveauHuile(polaires: number, s: SeuilsHuile): NiveauHuile {
  if (polaires >= s.rouge) return "bad";
  if (polaires >= s.orange) return "warn";
  return "ok";
}

/** Durée maximale d'une même huile (jours d'utilisation), sauf réglage contraire du siège. */
export const JOURS_HUILE_MAX = 14;
/** N° du jour d'utilisation de l'huile en place si la friteuse sert aujourd'hui (aujourd'hui compte déjà s'il a été saisi). */
export function jourHuile(e: Pick<EtatFriteuse, "jours_utilisation" | "aujourd_hui_at" | "aujourd_hui_non_utilisee"> | undefined): number {
  if (!e) return 1;
  const dejaCompte = !!e.aujourd_hui_at && !e.aujourd_hui_non_utilisee;
  return dejaCompte ? Math.max(1, e.jours_utilisation) : e.jours_utilisation + 1;
}
/** Âge de l'huile : au-delà du maximum, changement obligatoire ; les 2 derniers jours, prévenir. */
export function niveauAgeHuile(jour: number, max = JOURS_HUILE_MAX): NiveauHuile {
  if (jour > max) return "bad";
  if (jour >= max - 1) return "warn";
  return "ok";
}

/**
 * Ajoute à l'état des friteuses les mesures d'huile encore en attente d'envoi (tablette hors ligne ou envoi en cours),
 * pour ne pas redemander une friteuse déjà faite. Même règle que le serveur : un changement remet le compteur à 1,
 * « non utilisée » ne compte pas, un même jour ne compte qu'une fois.
 */
export function etatAvecEnAttente(etat: EtatFriteuse[], ops: { type: string; at_client: string; lignes?: unknown }[]): EtatFriteuse[] {
  const r = etat.map((e) => ({ ...e }));
  for (const op of ops) {
    if (op.type !== "huile") continue;
    const jourOp = new Date(op.at_client).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    if (jourOp !== new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" })) continue;   // mesure d'un autre jour, déjà comptée par le serveur à son arrivée
    for (const l of op.lignes as { friteuse_id: string; polaires: number | null; changement: boolean; non_utilisee?: boolean }[]) {
      const e = r.find((x) => x.friteuse_id === l.friteuse_id);
      if (!e) continue;
      const dejaCompte = !!e.aujourd_hui_at && !e.aujourd_hui_non_utilisee;
      if (l.changement) { e.jours_utilisation = 1; e.dernier_changement = op.at_client; }
      else if (!l.non_utilisee && !dejaCompte) e.jours_utilisation++;
      e.aujourd_hui_at = op.at_client; e.aujourd_hui_polaires = l.polaires; e.aujourd_hui_non_utilisee = !!l.non_utilisee;
    }
  }
  return r;
}

/** Seuils de réception (camion et produits frais ≤ +4 °C, surgelés ≤ −18 °C). */
export const SEUILS_LIVRAISON = { camion: 4, frais: 4, surgele: -18 } as const;
export function temperaturesLivraisonOk(t: { camion?: number; frais?: number; surgele?: number }): boolean {
  return (t.camion === undefined || t.camion <= SEUILS_LIVRAISON.camion)
    && (t.frais === undefined || t.frais <= SEUILS_LIVRAISON.frais)
    && (t.surgele === undefined || t.surgele <= SEUILS_LIVRAISON.surgele);
}

/** Service midi avant 16 h (heure de Paris), soir ensuite. */
export function service(maintenant: number): "midi" | "soir" {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Paris" }).formatToParts(maintenant);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  return h < 16 ? "midi" : "soir";
}

/** Chemin d'une photo dans le stockage : <site>/<aaaa-mm-jj>/<id>.webp. Le 1er segment sert aux règles d'accès par site. */
export function cheminPhoto(siteId: string, id: string, maintenant: number): string {
  const jour = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(maintenant);
  return `${siteId}/${jour}/${id}.webp`;
}

/** Refroidissement rapide : passer sous +10 °C en 2 h au plus. Remise en température : atteindre +63 °C en 1 h au plus. */
export const REGLES_MINUTEUR = {
  refroidissement: { duree: 120 * MIN, alerte: 105 * MIN, cible: 10 },
  remise_temperature: { duree: 60 * MIN, alerte: 50 * MIN, cible: 63 },
} as const;
export function minuteurConforme(type: keyof typeof REGLES_MINUTEUR, tFin: number, dureeMs: number): boolean {
  const r = REGLES_MINUTEUR[type];
  if (dureeMs > r.duree) return false;
  return type === "refroidissement" ? tFin < r.cible : tFin >= r.cible;
}

/** Cycle d'une anomalie : ouverte → traitée (par tous) → vérifiée (chef, responsable ou siège). */
export type StatutAnomalie = "ouverte" | "traitee" | "verifiee";
/** Écarts du PMS dont la clôture (si majeurs) revient au siège ; les écarts du quotidien sont clos par le chef. */
export const SOURCES_PMS = ["controle", "metrologie", "visite", "analyse"];
export const clotureSiege = (gravite: Gravite, source?: string) => gravite === "critique" || (gravite === "majeure" && SOURCES_PMS.includes(source ?? ""));

/** Clôture : par le chef ou le responsable, sauf action critique ou écart PMS majeur (siège). Comme le serveur. */
export function transitionPermise(de: StatutAnomalie, vers: StatutAnomalie, role: "equipe" | "chef" | "responsable" | "siege", gravite: Gravite = "mineure", source?: string): boolean {
  if (de === "ouverte" && vers === "traitee") return true;
  if (de === "traitee" && vers === "verifiee") return role === "siege" || (role !== "equipe" && !clotureSiege(gravite, source));
  return false;
}

/** Contrôles périodiques et sondes : libellé et couleur de l'état. */
export const ETAT_CONTROLE: Record<string, { libelle: string; classe: string }> = {
  a_jour: { libelle: "À jour", classe: "ok" }, bientot: { libelle: "Bientôt", classe: "warn" }, retard: { libelle: "En retard", classe: "bad" },
  jamais: { libelle: "Jamais fait", classe: "bad" }, hors_service: { libelle: "Hors service", classe: "bad" },
};

/** Métrologie : conformité d'une lecture (glace fondante 0 °C ± 0,5 ; eau bouillante 100 °C ± 1), comme le serveur. */
export function lectureConforme(methode: "glace" | "ebullition", valeur: number): boolean {
  return methode === "glace" ? Math.abs(valeur) <= 0.5 : Math.abs(valeur - 100) <= 1;
}

/** Une action est en retard si son échéance (jour, heure de Paris) est passée et qu'elle n'est pas corrigée. */
export function actionEnRetard(a: { statut: StatutAnomalie; echeance: string | null }, aujourdhui: string): boolean {
  return a.statut === "ouverte" && !!a.echeance && a.echeance < aujourdhui;
}

/** Tableau du siège : taux de tâches faites à l'heure (null si aucune tâche échue). */
export function tauxALheure(l: { taches_total: number; taches_a_lheure: number }): number | null {
  return l.taches_total ? l.taches_a_lheure / l.taches_total : null;
}
/** Plus le score est haut, plus le site demande d'attention. Sert à classer du pire au meilleur. */
export function scoreSite(l: {
  taches_total: number; taches_a_lheure: number; taches_non_faites: number; anomalies_ouvertes: number;
  anomalies_critiques: number; livraisons_nc: number; huile_rouges: number;
  anomalies_a_verifier?: number; huile_trop_vieille?: number;
}): number {
  const t = tauxALheure(l);
  return (t === null ? 0 : (1 - t) * 100) + l.taches_non_faites * 5 + l.anomalies_critiques * 30
    + l.anomalies_ouvertes * 5 + (l.anomalies_a_verifier ?? 0) * 2 + l.livraisons_nc * 10 + l.huile_rouges * 10
    + (l.huile_trop_vieille ?? 0) * 15;
}

/* ---------- Siège : état d'un restaurant ---------- */
export type NiveauResto = "rouge" | "orange" | "vert";
export interface Indicateur { nom: string; val: string; niveau: "ok" | "warn" | "bad" | "neutre" }
type EtatR = import("./types").EtatRestaurant;

/** Heures (Paris) pendant lesquelles une tablette muette est anormale, et durée de silence tolérée. */
export const SILENCE = { debut: 10, fin: 23, heures: 3 };

function heureParis(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" }).format(d));
}
/** Tablette silencieuse : rien saisi depuis plus de 3 h pendant les heures d'ouverture. */
export function tabletteSilencieuse(e: Pick<EtatR, "derniere_saisie">, maintenant = new Date()): boolean {
  const h = heureParis(maintenant);
  if (h < SILENCE.debut || h >= SILENCE.fin) return false;
  if (!e.derniere_saisie) return true;
  return maintenant.getTime() - new Date(e.derniere_saisie).getTime() > SILENCE.heures * 3600_000;
}
const pl = (n: number, s: string, p = s + "s") => `${n} ${n > 1 ? p : s}`;

/** Couleur d'un restaurant et les raisons, de la plus grave à la moins grave. */
export function statutRestaurant(e: EtatR, maintenant = new Date()): { niveau: NiveauResto; raisons: string[]; silencieuse: boolean } {
  const silencieuse = tabletteSilencieuse(e, maintenant);
  const rouges: string[] = [], oranges: string[] = [];
  if (e.anomalies_critiques) rouges.push(pl(e.anomalies_critiques, "anomalie critique", "anomalies critiques"));
  if (silencieuse) rouges.push(e.derniere_saisie ? `Tablette silencieuse depuis ${depuis(e.derniere_saisie, maintenant)}` : "Aucune saisie récente");
  if (e.taches_en_retard >= 2) rouges.push(`${e.taches_en_retard} tâches en retard`);
  if (e.taches_en_retard === 1) oranges.push("1 tâche en retard");
  if (e.releves_hors_seuil) oranges.push(`${pl(e.releves_hors_seuil, "température")} hors seuil`);
  if (e.huile_trop_vieille) oranges.push(`Huile trop vieille (${pl(e.huile_trop_vieille, "friteuse")})`);
  if (e.huile_rouges) oranges.push(`Huile au rouge (${pl(e.huile_rouges, "mesure")})`);
  if (e.livraisons_nc) oranges.push(pl(e.livraisons_nc, "livraison non conforme", "livraisons non conformes"));
  if (e.anomalies_ouvertes) oranges.push(pl(e.anomalies_ouvertes, "anomalie à traiter", "anomalies à traiter"));
  if (e.anomalies_a_verifier) oranges.push(pl(e.anomalies_a_verifier, "anomalie à vérifier", "anomalies à vérifier"));
  const niveau: NiveauResto = rouges.length ? "rouge" : oranges.length ? "orange" : "vert";
  return { niveau, raisons: [...rouges, ...oranges], silencieuse };
}

/** Les 4 indicateurs d'une carte restaurant. */
export function indicateursRestaurant(e: EtatR): Indicateur[] {
  const temp: Indicateur = e.releves_hors_seuil ? { nom: "Températures", val: `${e.releves_hors_seuil} hors seuil`, niveau: "bad" }
    : !e.enceintes ? { nom: "Températures", val: "—", niveau: "neutre" }
    : e.enceintes_relevees >= e.enceintes ? { nom: "Températures", val: "OK", niveau: "ok" }
    : e.enceintes_relevees === 0 ? { nom: "Températures", val: "pas encore", niveau: "neutre" }
    : { nom: "Températures", val: `${e.enceintes_relevees}/${e.enceintes} relevées`, niveau: "warn" };
  const huile: Indicateur = e.huile_trop_vieille ? { nom: "Huile", val: `${e.huile_trop_vieille} trop vieille`, niveau: "bad" }
    : e.huile_rouges ? { nom: "Huile", val: `${e.huile_rouges} au rouge`, niveau: "bad" }
    : !e.friteuses ? { nom: "Huile", val: "—", niveau: "neutre" }
    : e.friteuses_faites === 0 ? { nom: "Huile", val: "pas encore", niveau: "neutre" }
    : e.friteuses_faites < e.friteuses ? { nom: "Huile", val: `${e.friteuses_faites}/${e.friteuses} faites`, niveau: "warn" }
    : { nom: "Huile", val: e.huile_max === null ? "OK" : `OK · ${String(e.huile_max).replace(".", ",")} %`, niveau: "ok" };
  const livr: Indicateur = e.livraisons_nc ? { nom: "Livraisons", val: `${e.livraisons_nc} non conforme${e.livraisons_nc > 1 ? "s" : ""}`, niveau: "warn" }
    : e.livraisons_non_rangees ? { nom: "Livraisons", val: `${e.livraisons_non_rangees} non rangée${e.livraisons_non_rangees > 1 ? "s" : ""}`, niveau: "warn" }
    : e.livraisons ? { nom: "Livraisons", val: `${e.livraisons} conforme${e.livraisons > 1 ? "s" : ""}`, niveau: "ok" }
    : { nom: "Livraisons", val: "aucune", niveau: "neutre" };
  const anom: Indicateur = e.anomalies_critiques ? { nom: "Anomalies", val: `${e.anomalies_critiques} critique${e.anomalies_critiques > 1 ? "s" : ""}`, niveau: "bad" }
    : e.anomalies_ouvertes ? { nom: "Anomalies", val: `${e.anomalies_ouvertes} à traiter`, niveau: "warn" }
    : e.anomalies_a_verifier ? { nom: "Anomalies", val: `${e.anomalies_a_verifier} à vérifier`, niveau: "warn" }
    : { nom: "Anomalies", val: "0", niveau: "ok" };
  return [temp, huile, livr, anom];
}

/** « 6 min », « 3 h 10 », « 2 j ». */
export function depuis(iso: string, maintenant = new Date()): string {
  const m = Math.max(0, Math.round((maintenant.getTime() - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) { const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`; }
  return `${Math.floor(m / 1440)} j`;
}
const ORDRE_RESTO: Record<NiveauResto, number> = { rouge: 0, orange: 1, vert: 2 };
/** Tri de l'accueil : rouge, orange, vert ; à niveau égal, le plus de raisons d'abord, puis par nom. */
export function trierRestaurants<T extends EtatR>(liste: T[], maintenant = new Date()): (T & { statut: ReturnType<typeof statutRestaurant> })[] {
  return liste.map((e) => ({ ...e, statut: statutRestaurant(e, maintenant) }))
    .sort((a, b) => ORDRE_RESTO[a.statut.niveau] - ORDRE_RESTO[b.statut.niveau] || b.statut.raisons.length - a.statut.raisons.length || a.nom.localeCompare(b.nom, "fr"));
}

/* ---------- Valeurs vraisemblables (refus des fautes de frappe) ---------- */
export interface Bornes { min: number; max: number; message: string }
/** Enceinte positive (max ≥ 0 °C) : de −3 à +20 °C ; négative : de −40 à +15 °C. Au-delà, c'est une erreur de saisie. */
export function bornesReleve(t_max: number): Bornes {
  return t_max >= 0
    ? { min: -3, max: 20, message: "Impossible pour une enceinte positive : entre −3 et +20 °C." }
    : { min: -40, max: 15, message: "Impossible pour une enceinte négative : entre −40 et +15 °C." };
}
export const BORNES_HUILE: Bornes = { min: 0, max: 40, message: "Un testeur affiche entre 0 et 40 % de composés polaires." };
export const BORNES_LIVRAISON: Record<"camion" | "frais" | "surgele", Bornes> = {
  camion: { min: -30, max: 25, message: "Température de camion impossible : entre −30 et +25 °C." },
  frais: { min: -5, max: 25, message: "Produit frais : entre −5 et +25 °C." },
  surgele: { min: -40, max: 5, message: "Produit surgelé : entre −40 et +5 °C." },
};
export const dansBornes = (v: number, b: Bornes) => v >= b.min && v <= b.max;

/* ---------- Réception de livraison : verdict automatique ---------- */
export type ProblemeLivraison = "Emballage abîmé" | "DLC trop courte" | "Produit manquant" | "Produit non commandé";
export const PROBLEMES_LIVRAISON: ProblemeLivraison[] = ["Emballage abîmé", "DLC trop courte", "Produit manquant", "Produit non commandé"];
export const DECISIONS_LIVRAISON = [
  { cle: "Tout refusé", detail: "le camion repart avec tout" },
  { cle: "Une partie refusée", detail: "on garde le reste" },
  { cle: "Accepté sous réserve", detail: "réserve écrite sur le BL" },
] as const;
/**
 * Verdict calculé, jamais choisi : non conforme dès qu'une température dépasse son seuil, qu'un problème est signalé
 * ou que l'origine d'une viande manque. `motifs` sert à l'anomalie et aux statistiques fournisseurs.
 */
export function verdictLivraison(r: { camion?: number; frais?: number; surgele?: number; problemes: string[]; viande: boolean; origine: boolean | null }): { conforme: boolean; motifs: string[]; graveTemperature: boolean } {
  const temp = !temperaturesLivraisonOk({ camion: r.camion, frais: r.frais, surgele: r.surgele });
  const motifs = [...(temp ? ["Température"] : []), ...r.problemes, ...(r.viande && r.origine === false ? ["Origine viande absente"] : [])];
  return { conforme: motifs.length === 0, motifs, graveTemperature: temp };
}
/** Fournisseurs attendus aujourd'hui en premier (jours de livraison habituels), puis les autres par nom. */
export function trierFournisseurs<T extends { nom: string; jours?: number[] | null }>(l: T[], maintenant = new Date()): (T & { attendu: boolean })[] {
  const j = ((maintenant.getDay() + 6) % 7) + 1;   // 1 = lundi … 7 = dimanche
  return l.map((f) => ({ ...f, attendu: !!f.jours?.includes(j) }))
    .sort((a, b) => Number(b.attendu) - Number(a.attendu) || a.nom.localeCompare(b.nom, "fr"));
}

/** Températures à demander selon ce que livre le fournisseur (inconnu : toutes). Le camion est toujours mesuré. */
export function temperaturesDemandees(produits?: readonly string[] | null): { frais: boolean; surgele: boolean } {
  if (!produits?.length) return { frais: true, surgele: true };
  return { frais: produits.includes("frais"), surgele: produits.includes("surgele") };
}
export const LIBELLE_PRODUITS: Record<string, string> = { frais: "frais", sec: "sec", surgele: "surgelés" };
