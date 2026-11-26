import { useCallback, useEffect, useState } from "react";

/**
 * Minuteurs en cours, gardés sur la tablette (ils survivent à un rechargement de la page ou à un changement d'utilisateur).
 * Semaine 2 : rangement des livraisons. Semaine 3 : refroidissement et remise en température.
 */
export interface Minuteur {
  id: string;
  type: "rangement" | "refroidissement" | "remise_temperature";
  libelle: string;
  debut: number;        // ms
  duree: number;        // ms
  alerte: number;       // ms écoulées avant l'alerte « bientôt »
  ref?: string;         // id de la livraison, du plat…
  donnees?: Record<string, unknown>;
}
export type EtatMinuteur = "encours" | "alerte" | "depasse";
export function etatMinuteur(m: Minuteur, maintenant: number): EtatMinuteur {
  const e = maintenant - m.debut;
  if (e > m.duree) return "depasse";
  return e >= m.alerte ? "alerte" : "encours";
}

const CLE = "suivi-hygiene:minuteurs";
function lire(): Minuteur[] {
  // Le rangement des livraisons n'est plus suivi (demande du chef exécutif) : un ancien chrono de rangement resté en mémoire est oublié.
  try { const v = JSON.parse(localStorage.getItem(CLE) || "[]"); return Array.isArray(v) ? v.filter((m: Minuteur) => m.type !== "rangement") : []; } catch { return []; }
}
function ecrire(l: Minuteur[]) { try { localStorage.setItem(CLE, JSON.stringify(l)); } catch { /* stockage indisponible : minuteurs en mémoire seulement */ } }

export function useMinuteurs() {
  const [liste, setListe] = useState<Minuteur[]>(lire);
  useEffect(() => {
    const f = (e: StorageEvent) => { if (e.key === CLE) setListe(lire()); };
    window.addEventListener("storage", f);
    return () => window.removeEventListener("storage", f);
  }, []);
  const ajouter = useCallback((m: Minuteur) => setListe((l) => { const n = [...l, m]; ecrire(n); return n; }), []);
  const retirer = useCallback((id: string) => setListe((l) => { const n = l.filter((x) => x.id !== id); ecrire(n); return n; }), []);
  return { liste, ajouter, retirer };
}
