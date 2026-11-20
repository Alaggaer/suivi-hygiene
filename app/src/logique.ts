/** Règles métier pures (sans écran ni serveur) : ce sont elles que les tests unitaires vérifient. */
import type { EtatFriteuse, SeuilsHuile, Tache } from "./types";

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
export function transitionPermise(de: StatutAnomalie, vers: StatutAnomalie, role: "equipe" | "chef" | "responsable" | "siege"): boolean {
  if (de === "ouverte" && vers === "traitee") return true;
  if (de === "traitee" && vers === "verifiee") return role !== "equipe";
  return false;
}

/** Tableau du siège : taux de tâches faites à l'heure (null si aucune tâche échue). */
export function tauxALheure(l: { taches_total: number; taches_a_lheure: number }): number | null {
  return l.taches_total ? l.taches_a_lheure / l.taches_total : null;
}
/** Plus le score est haut, plus le site demande d'attention. Sert à classer du pire au meilleur. */
export function scoreSite(l: {
  taches_total: number; taches_a_lheure: number; taches_non_faites: number; anomalies_ouvertes: number;
  anomalies_critiques: number; livraisons_nc: number; huile_rouges: number;
}): number {
  const t = tauxALheure(l);
  return (t === null ? 0 : (1 - t) * 100) + l.taches_non_faites * 5 + l.anomalies_critiques * 30
    + l.anomalies_ouvertes * 5 + l.livraisons_nc * 10 + l.huile_rouges * 10;
}
