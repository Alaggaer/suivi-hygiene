import type { Api } from "../types";
import { cmp, type Action, type Existant } from "./parametrage";

/** Ce qui existe déjà, pour comparer avec le tableau. */
export async function chargerExistant(api: Api): Promise<Existant> {
  const [sites, fournisseurs] = await Promise.all([api.sitesGestion(), api.fournisseursGestion()]);
  const ex: Existant = { sites, fournisseurs, enceintes: {}, friteuses: {}, employes: {} };
  await Promise.all(sites.map(async (s) => {
    const [r, e] = await Promise.all([api.referentielSite(s.id), api.employesSite(s.id)]);
    ex.enceintes[s.id] = r.enceintes; ex.friteuses[s.id] = r.friteuses; ex.employes[s.id] = e;
  }));
  return ex;
}

export interface Resultat { faits: number; pins: { restaurant: string; nom: string; pin: string }[]; erreurs: { libelle: string; message: string }[] }

/**
 * Applique le plan, une action après l'autre : les restaurants d'abord (pour connaître leur identifiant),
 * puis le reste. Une action refusée n'arrête pas les suivantes ; elle est rapportée.
 */
export async function appliquer(api: Api, actions: Action[], progres: (fait: number) => void = () => {}): Promise<Resultat> {
  const res: Resultat = { faits: 0, pins: [], erreurs: [] };
  let n = 0;
  const essayer = async (a: Action, f: () => Promise<void>) => {
    try { await f(); res.faits++; } catch (e) { res.erreurs.push({ libelle: a.libelle, message: (e as Error).message }); }
    progres(++n);
  };
  for (const a of actions) {
    if (a.t === "site_creer") await essayer(a, async () => { await api.siegeCreerRestaurant(a.nom, a.ville, a.ouverture, a.soir); });
    else if (a.t === "site_maj") await essayer(a, () => api.siegeEnregistrer("sites", { ...a.ligne }));
  }
  // Liste des restaurants relue (identifiants des nouveaux). Si la relecture échoue, chaque action le dit, rien n'est perdu.
  let ids = new Map<string, string>(), relecture: string | null = null;
  try { ids = new Map((await api.sitesGestion()).map((s) => [cmp(s.nom), s.id])); }
  catch (e) { relecture = (e as Error).message; }
  const site = (r: string) => {
    const id = ids.get(cmp(r));
    if (!id) throw new Error(relecture ? `liste des restaurants illisible (${relecture}) : relancez l'import` : `Restaurant ${r} introuvable`);
    return id;
  };
  for (const a of actions) {
    if (a.t === "enceinte") await essayer(a, () => api.siegeEnregistrer("enceintes", { ...a.ligne, site_id: site(a.restaurant) }));
    else if (a.t === "friteuse") await essayer(a, () => api.siegeEnregistrer("friteuses", { ...a.ligne, site_id: site(a.restaurant) }));
    else if (a.t === "employe") await essayer(a, async () => { res.pins.push({ restaurant: a.restaurant, nom: a.nom, pin: await api.siegeAjouterEmploye(site(a.restaurant), a.nom, a.role) }); });
    else if (a.t === "fournisseur") await essayer(a, () => api.siegeEnregistrer("fournisseurs", { ...a.ligne }));
  }
  return res;
}
