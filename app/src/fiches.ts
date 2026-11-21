import type { Api } from "./types";

/**
 * Fiches techniques et de sécurité des produits d'entretien, gardées sur la tablette
 * pour rester lisibles sans réseau (une FDS doit pouvoir être consultée tout de suite en cas d'accident).
 * Une fiche déposée par le siège a toujours un nouveau chemin : une fiche gardée n'est jamais périmée.
 */
const NOM = "suivi-hygiene-fiches";
const cleDe = (chemin: string) => `https://fiches.suivi-hygiene/${chemin}`;
const cacheDispo = () => typeof caches !== "undefined";

async function telecharger(api: Api, chemin: string): Promise<Blob> {
  const r = await fetch(await api.urlPhoto(chemin));
  if (!r.ok) throw new Error(`Fiche indisponible (${r.status})`);
  if (cacheDispo()) { try { await (await caches.open(NOM)).put(cleDe(chemin), r.clone()); } catch { /* stockage plein : on lit quand même */ } }
  return r.blob();
}

/** La fiche : depuis la tablette si elle y est, sinon téléchargée (et gardée). */
export async function lireFiche(api: Api, chemin: string): Promise<Blob> {
  if (cacheDispo()) {
    try { const r = await (await caches.open(NOM)).match(cleDe(chemin)); if (r) return r.blob(); } catch { /* cache indisponible */ }
  }
  return telecharger(api, chemin);
}

/** Garde sur la tablette toutes les fiches pas encore téléchargées (en tâche de fond, sans bloquer). */
export async function prechargerFiches(api: Api, chemins: string[]): Promise<number> {
  if (!cacheDispo()) return 0;
  let n = 0;
  const c = await caches.open(NOM);
  for (const chemin of new Set(chemins)) {
    try { if (!(await c.match(cleDe(chemin)))) { await telecharger(api, chemin); n++; } } catch { /* hors ligne : au prochain passage */ }
  }
  return n;
}
