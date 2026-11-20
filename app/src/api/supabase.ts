import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Anomalie, Api, Site, Tache } from "../types";

/**
 * Production : chaque tablette est connectée avec le compte Supabase de son site
 * (app_metadata.site_id posé par le siège). La personne est identifiée par son PIN.
 * Les horodatages officiels sont ceux du serveur ; l'heure de la tablette est gardée à part (at_client).
 */
export function supabaseApi(url: string, cleAnon: string): Api {
  const sb: SupabaseClient = createClient(url, cleAnon, { auth: { persistSession: true, storageKey: "suivi-hygiene-tablette" } });

  async function siteId(): Promise<string> {
    const { data } = await sb.auth.getSession();
    const id = data.session?.user.app_metadata?.site_id as string | undefined;
    if (!id) throw new Error("Cette tablette n'est rattachée à aucun site. Demandez au siège de l'activer.");
    return id;
  }
  function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
    if (r.error) throw new Error(r.error.message);
    if (r.data === null) throw new Error("Réponse vide du serveur");
    return r.data;
  }
  function okVide(r: { error: { message: string } | null }): void {
    if (r.error) throw new Error(r.error.message);
  }
  async function terminerTache(tacheId: string | undefined, profilId: string) {
    if (tacheId) okVide(await sb.rpc("terminer_tache", { p_tache: tacheId, p_profil: profilId }));
  }

  return {
    mode: "supabase",
    async estActivee() { const { data } = await sb.auth.getSession(); return !!data.session; },
    async activer(email, motDePasse) {
      const { error } = await sb.auth.signInWithPassword({ email, password: motDePasse });
      if (error) throw new Error("Identifiants refusés. Vérifiez l'adresse et le mot de passe de la tablette.");
    },
    async site() {
      return ok(await sb.from("sites").select("id, nom, ville").eq("id", await siteId()).single()) as Site;
    },
    async profils() { return ok(await sb.rpc("profils_du_site")); },
    async verifierPin(profilId, pin) { return ok(await sb.rpc("verifier_pin", { p_profil: profilId, p_pin: pin })) as boolean; },
    async taches() {
      okVide(await sb.rpc("generer_taches"));
      const rows = ok(await sb.rpc("taches_du_jour")) as Tache[];
      return rows;
    },
    async enceintes() {
      return ok(await sb.from("enceintes").select("id, nom, t_max").eq("actif", true).order("ordre")).map((e) => ({ ...e, t_max: Number(e.t_max) }));
    },
    async friteuses() {
      return ok(await sb.from("friteuses").select("id, nom, litres").eq("actif", true).order("nom")).map((f) => ({ ...f, litres: Number(f.litres) }));
    },
    async seuilsHuile() {
      const r = ok(await sb.from("reglages").select("valeur").eq("cle", "huile").single()) as { valeur: unknown };
      return r.valeur as { orange: number; rouge: number };
    },
    async anomaliesOuvertes() {
      return ok(await sb.from("anomalies").select("id, titre, categorie, gravite, statut, cree_at").neq("statut", "verifiee").order("cree_at", { ascending: false })) as Anomalie[];
    },
    async enregistrerReleves(par, items, tacheId) {
      const site_id = await siteId(), at_client = new Date().toISOString();
      okVide(await sb.from("releves").insert(items.map((i) => ({ ...i, site_id, tache_id: tacheId ?? null, par: par.id, at_client }))));
      await terminerTache(tacheId, par.id);
    },
    async enregistrerHuile(par, items, tacheId) {
      const site_id = await siteId(), at_client = new Date().toISOString();
      okVide(await sb.from("huiles").insert(items.map((i) => ({ ...i, site_id, tache_id: tacheId ?? null, par: par.id, at_client }))));
      await terminerTache(tacheId, par.id);
    },
    async creerAnomalies(par, items) {
      if (!items.length) return;
      const site_id = await siteId();
      okVide(await sb.from("anomalies").insert(items.map((a) => ({ ...a, site_id, cree_par: par.id }))));
    },
  };
}
