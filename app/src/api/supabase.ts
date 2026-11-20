import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Anomalie, Api, Fournisseur, FournisseurNC, LigneSiege, Site, Tache } from "../types";
import { ErreurDefinitive, type Operation } from "../operations";

/**
 * Production : chaque tablette est connectée avec le compte Supabase de son site
 * (app_metadata.site_id posé par le siège). La personne est identifiée par son PIN.
 * Les écritures passent par la file d'envoi : elles portent leur identifiant et sont rejouables sans doublon.
 */
type Reponse<T> = { data: T | null; error: { message: string; code?: string } | null; status?: number };

/** Réseau coupé, serveur indisponible, session expirée ou trop de requêtes : on réessaiera. Le reste est définitif. */
export function estPassager(status: number | undefined): boolean {
  return !status || status >= 500 || status === 401 || status === 408 || status === 429;
}
function verifier(r: { error: { message: string } | null; status?: number }): void {
  if (!r.error) return;
  if (estPassager(r.status)) throw new Error(r.error.message);
  throw new ErreurDefinitive(r.error.message);
}

export function supabaseApi(url: string, cleAnon: string): Api {
  const sb: SupabaseClient = createClient(url, cleAnon, { auth: { persistSession: true, storageKey: "suivi-hygiene-tablette" } });

  async function siteId(): Promise<string> {
    const { data } = await sb.auth.getSession();
    const id = data.session?.user.app_metadata?.site_id as string | undefined;
    if (!id) throw new Error("Cette tablette n'est rattachée à aucun site. Demandez au siège de l'activer.");
    return id;
  }
  function ok<T>(r: Reponse<T>): T {
    if (r.error) throw new Error(r.error.message);
    if (r.data === null) throw new Error("Réponse vide du serveur");
    return r.data;
  }
  /** Insertion rejouable : une ligne déjà reçue (même id) est ignorée. */
  async function inserer(table: string, lignes: Record<string, unknown>[]) {
    if (!lignes.length) return;
    verifier(await sb.from(table).upsert(lignes, { onConflict: "id", ignoreDuplicates: true }));
  }

  return {
    mode: "supabase",
    async estActivee() { const { data } = await sb.auth.getSession(); return !!data.session; },
    async activer(email, motDePasse) {
      const { error } = await sb.auth.signInWithPassword({ email, password: motDePasse });
      if (error) throw new Error("Identifiants refusés. Vérifiez l'adresse et le mot de passe de la tablette.");
    },
    async site() { return ok(await sb.from("sites").select("id, nom, ville").eq("id", await siteId()).single()) as Site; },
    async profils() { return ok(await sb.rpc("profils_du_site")); },
    async verifierPin(profilId, pin) { return ok(await sb.rpc("verifier_pin", { p_profil: profilId, p_pin: pin })) as boolean; },
    async taches() {
      const g = await sb.rpc("generer_taches");
      if (g.error) throw new Error(g.error.message);
      return ok(await sb.rpc("taches_du_jour")) as Tache[];
    },
    async enceintes() {
      return (ok(await sb.from("enceintes").select("id, nom, t_max").eq("actif", true).order("ordre")) as { id: string; nom: string; t_max: string | number }[])
        .map((e) => ({ ...e, t_max: Number(e.t_max) }));
    },
    async friteuses() {
      return (ok(await sb.from("friteuses").select("id, nom, litres").eq("actif", true).order("nom")) as { id: string; nom: string; litres: string | number }[])
        .map((f) => ({ ...f, litres: Number(f.litres) }));
    },
    async seuilsHuile() {
      const r = ok(await sb.from("reglages").select("valeur").eq("cle", "huile").single()) as { valeur: { orange: number; rouge: number } };
      return r.valeur;
    },
    async estSiege() {
      const { data } = await sb.auth.getSession();
      return data.session?.user.app_metadata?.role === "siege";
    },
    async tableauSiege(jours) { return ok(await sb.rpc("tableau_siege", { p_jours: jours })) as LigneSiege[]; },
    async fournisseursNonConformes(jours) { return ok(await sb.rpc("fournisseurs_non_conformes", { p_jours: jours })) as FournisseurNC[]; },
    async fournisseurs() { return ok(await sb.from("fournisseurs").select("id, nom").eq("actif", true).order("nom")) as Fournisseur[]; },
    async anomaliesOuvertes() {
      return ok(await sb.from("anomalies").select("id, titre, categorie, gravite, statut, cree_at").neq("statut", "verifiee").order("cree_at", { ascending: false })) as Anomalie[];
    },

    async televerserPhoto(chemin, blob) {
      const { error } = await sb.storage.from("photos").upload(chemin, blob, { contentType: "image/webp", upsert: false });
      if (!error) return;
      const e = error as { message: string; statusCode?: string };
      if (e.statusCode === "409" || /exists|duplicate/i.test(e.message)) return; // déjà envoyée lors d'un essai précédent
      throw estPassager(Number(e.statusCode) || undefined) ? new Error(e.message) : new ErreurDefinitive(e.message);
    },

    async executer(op: Operation) {
      const site_id = await siteId();
      const commun = { site_id, par: op.par, at_client: op.at_client };
      switch (op.type) {
        case "releves":
          await inserer("releves", op.lignes.map((l) => ({ ...l, ...commun, tache_id: op.tache_id ?? null })));
          if (op.tache_id) verifier(await sb.rpc("terminer_tache", { p_tache: op.tache_id, p_profil: op.par, p_at_client: op.at_client }));
          break;
        case "huile":
          await inserer("huiles", op.lignes.map((l) => ({ ...l, ...commun, tache_id: op.tache_id ?? null })));
          if (op.tache_id) verifier(await sb.rpc("terminer_tache", { p_tache: op.tache_id, p_profil: op.par, p_at_client: op.at_client }));
          break;
        case "terminer_tache":
          verifier(await sb.rpc("terminer_tache", { p_tache: op.tache_id, p_profil: op.par, p_at_client: op.at_client }));
          break;
        case "anomalies":
          await inserer("anomalies", op.lignes.map((a) => ({ ...a, site_id, cree_par: op.par, cree_at_client: op.at_client })));
          break;
        case "livraison": {
          await inserer("livraisons", [{
            id: op.id, site_id, par: op.par, at_client: op.at_client, fournisseur_id: op.fournisseur_id,
            t_camion: op.t_camion, t_frais: op.t_frais ?? null, t_surgele: op.t_surgele ?? null, photo_bl: op.photo_bl,
            viande: op.viande, origine_ok: op.origine_ok ?? null, conforme: op.conforme,
            motifs: op.motifs ?? null, action: op.action ?? null, photo_nc: op.photo_nc ?? null,
          }]);
          break;
        }
        case "livraison_rangee":
          verifier(await sb.rpc("marquer_rangee", { p_livraison: op.livraison_id, p_at_client: op.at_client }));
          break;
        case "minuteur":
          await inserer("minuteurs", [{
            id: op.id, site_id, par: op.par, type: op.type_minuteur, plat: op.plat, t_debut: op.t_debut, debut_at: op.debut_at,
            t_fin: op.t_fin, fin_at: op.fin_at, conforme: op.conforme, action: op.action ?? null,
          }]);
          break;
        case "anomalie_statut":
          verifier(await sb.rpc("changer_statut_anomalie", {
            p_anomalie: op.anomalie_id, p_statut: op.statut, p_profil: op.par, p_commentaire: op.commentaire ?? null, p_at_client: op.at_client,
          }));
          break;
        case "utilisation":
          await inserer("utilisations", [{ id: op.id, ...commun, photo: op.photo, famille: op.famille, service: op.service }]);
          break;
      }
    },
  };
}
