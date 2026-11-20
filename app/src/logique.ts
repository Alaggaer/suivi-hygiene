/** Règles métier pures (sans écran ni serveur) : ce sont elles que les tests unitaires vérifient. */
import type { SeuilsHuile, Tache } from "./types";

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
