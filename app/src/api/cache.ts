import type { Api } from "../types";

/**
 * Lectures utilisables hors ligne : chaque réponse est gardée sur la tablette ;
 * si le serveur est injoignable, on ressert la dernière réponse connue.
 * Connexion hors ligne : après une première connexion réussie en ligne, une empreinte du PIN
 * (SHA-256 salée par la personne) est gardée pour pouvoir reconnaître la personne sans réseau.
 */
export interface Memoire { get(cle: string): string | null; set(cle: string, v: string): void; vider?(prefixe: string): void }
export const memoireLocale: Memoire = {
  get: (c) => { try { return localStorage.getItem(c); } catch { return null; } },
  set: (c, v) => { try { localStorage.setItem(c, v); } catch { /* plein ou indisponible */ } },
  vider: (prefixe) => {
    try { Object.keys(localStorage).filter((k) => k.startsWith(prefixe)).forEach((k) => localStorage.removeItem(k)); } catch { /* indisponible */ }
  },
};

const PREFIXE = "suivi-hygiene:cache:";
const LECTURES = ["site", "profils", "taches", "enceintes", "friteuses", "seuilsHuile", "etatFriteuses", "livraisonsDuJour", "stocksMortsDuSite", "alertesDuSite", "nettoyageDuJour", "produitsEntretien", "fournisseurs", "anomaliesOuvertes"] as const;

/** Lectures valables pour la journée seulement : hors ligne, on ne ressert pas les tâches d'hier comme celles d'aujourd'hui. */
const DU_JOUR = new Set<string>(["taches", "etatFriteuses", "livraisonsDuJour", "nettoyageDuJour"]);
const aujourdhui = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

/** Distingue « pas de réseau » (on ressert le cache) d'un vrai refus du serveur (on le montre). */
export function estErreurReseau(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof Error && /fetch|network|réseau|offline|timeout/i.test(e.message));
}

async function empreinte(profilId: string, pin: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`suivi-hygiene|${profilId}|${pin}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function avecCache(api: Api, memoire: Memoire = memoireLocale): Api {
  const enveloppe: Api = { ...api };
  for (const nom of LECTURES) {
    const lire = api[nom].bind(api) as () => Promise<unknown>;
    (enveloppe as unknown as Record<string, () => Promise<unknown>>)[nom] = async () => {
      try {
        const v = await lire();
        memoire.set(PREFIXE + nom, JSON.stringify(DU_JOUR.has(nom) ? { jour: aujourdhui(), v } : v));
        return v;
      } catch (e) {
        const c = memoire.get(PREFIXE + nom);
        if (c === null || !estErreurReseau(e)) throw e;
        const lu = JSON.parse(c);
        if (!DU_JOUR.has(nom)) return lu;
        if (lu && typeof lu === "object" && "jour" in lu && lu.jour === aujourdhui()) return lu.v;
        // Huile : l'âge de l'huile d'hier reste vrai (sinon l'app afficherait « jour 1 » et oublierait un changement obligatoire) ;
        // seules les valeurs « mesurée aujourd'hui » sont effacées.
        if (nom === "etatFriteuses" && lu && typeof lu === "object" && Array.isArray((lu as { v?: unknown }).v)) {
          return (lu as { v: Record<string, unknown>[] }).v.map((f) => ({ ...f, aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null }));
        }
        throw e;   // copie d'un autre jour : on n'affiche pas de fausses informations
      }
    };
  }
  // Nouvelle activation (autre restaurant possible) : on oublie tout ce qui était gardé.
  enveloppe.activer = async (email, motDePasse) => {
    await api.activer(email, motDePasse);
    memoire.vider?.(PREFIXE);
  };
  enveloppe.verifierPin = async (profilId, pin) => {
    const cle = PREFIXE + "pin:" + profilId;
    try {
      const ok = await api.verifierPin(profilId, pin);
      if (ok) memoire.set(cle, await empreinte(profilId, pin));
      return ok;
    } catch (e) {
      const connue = memoire.get(cle);
      if (connue && estErreurReseau(e)) return connue === (await empreinte(profilId, pin));
      throw e;
    }
  };
  return enveloppe;
}
