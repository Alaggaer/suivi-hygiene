import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Anomalie, AnomalieSiege, Api, Correction, LivraisonJour, StockMort, StockMortSiege, Enceinte, Friteuse, EtatRestaurant, JourHistorique, Preuves, EtatFriteuse, Fournisseur, FournisseurNC, LigneSiege, SeuilsHuile, Site, Tache } from "../types";
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
    // defaultToNull: false : une clé absente d'une ligne prend la valeur par défaut de la colonne, pas NULL
    // (sinon, dans un envoi groupé, une ligne sans « non_utilisee » était refusée).
    verifier(await sb.from(table).upsert(lignes, { onConflict: "id", ignoreDuplicates: true, defaultToNull: false }));
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
      const r = ok(await sb.from("reglages").select("valeur").eq("cle", "huile").single()) as { valeur: SeuilsHuile };
      return r.valeur;
    },
    async etatFriteuses() {
      return (ok(await sb.rpc("etat_friteuses")) as (EtatFriteuse & { aujourd_hui_polaires: string | number | null })[])
        .map((e) => ({ ...e, aujourd_hui_polaires: e.aujourd_hui_polaires === null ? null : Number(e.aujourd_hui_polaires) }));
    },
    async estSiege() {
      const { data } = await sb.auth.getSession();
      return data.session?.user.app_metadata?.role === "siege";
    },
    async tableauSiege(jours) { return ok(await sb.rpc("tableau_siege_v2", { p_jours: jours })) as LigneSiege[]; },
    async fournisseursNonConformes(jours) { return ok(await sb.rpc("fournisseurs_non_conformes", { p_jours: jours })) as FournisseurNC[]; },
    async etatRestaurants() {
      return (ok(await sb.rpc("etat_restaurants")) as EtatRestaurant[]).map((e) => ({ ...e, huile_max: e.huile_max === null ? null : Number(e.huile_max) }));
    },
    async historiqueSite(siteId, jours) { return ok(await sb.rpc("historique_site", { p_site: siteId, p_jours: jours })) as JourHistorique[]; },
    async anomaliesSiege() { return ok(await sb.rpc("anomalies_siege")) as AnomalieSiege[]; },
    async siegeChangerStatut(id, statut, commentaire) {
      verifier(await sb.rpc("siege_changer_statut", { p_anomalie: id, p_statut: statut, p_commentaire: commentaire ?? null }));
    },
    async preuvesJour(siteId, jour) {
      const p = ok(await sb.rpc("preuves_jour", { p_site: siteId, p_jour: jour })) as Preuves;
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      const corr = (c: Correction | null | undefined) => (c ? { ...c, valeur: n(c.valeur) } : null);
      return {
        ...p,
        releves: p.releves.map((r) => ({ ...r, valeur: Number(r.valeur), t_max: Number(r.t_max), correction: corr(r.correction) })),
        huiles: p.huiles.map((h) => ({ ...h, polaires: n(h.polaires), correction: corr(h.correction) })),
        livraisons: p.livraisons.map((l) => ({ ...l, t_camion: Number(l.t_camion), t_frais: n(l.t_frais), t_surgele: n(l.t_surgele), correction: corr(l.correction) })),
      };
    },
    async siegeCorriger(table, id, motif, valeur) {
      verifier(await sb.rpc("siege_corriger", { p_table: table, p_id: id, p_motif: motif, p_valeur: valeur }));
    },
    async equipementsSite(siteId) {
      const [e, f] = await Promise.all([
        sb.from("enceintes").select("id, nom, t_max").eq("site_id", siteId).eq("actif", true).order("ordre"),
        sb.from("friteuses").select("id, nom, litres").eq("site_id", siteId).eq("actif", true).order("nom"),
      ]);
      return {
        enceintes: (ok(e) as Enceinte[]).map((x) => ({ ...x, t_max: Number(x.t_max) })),
        friteuses: (ok(f) as Friteuse[]).map((x) => ({ ...x, litres: Number(x.litres) })),
      };
    },
    async siegeRattraper(r) {
      verifier(await sb.rpc("siege_rattraper", {
        p_type: r.type, p_equipement: r.equipement, p_at: r.at, p_valeur: r.valeur, p_motif: r.motif,
        p_action: r.type === "releve" ? r.action : null, p_decision: r.type === "huile" ? r.decision : null,
      }));
    },
    async urlPhoto(chemin) {
      const { data, error } = await sb.storage.from("photos").createSignedUrl(chemin, 3600);
      if (error || !data) throw new Error(error?.message ?? "Photo introuvable");
      return data.signedUrl;
    },
    async fournisseurs() {
      return (ok(await sb.from("fournisseurs").select("id, nom, viande, jours_livraison, produits").eq("actif", true).order("nom")) as (Fournisseur & { jours_livraison: number[] | null })[])
        .map((f) => ({ id: f.id, nom: f.nom, viande: f.viande, jours: f.jours_livraison, produits: f.produits }));
    },
    async stocksMortsDuSite() { return ok(await sb.rpc("stocks_morts_du_site")) as StockMort[]; },
    async stocksMortsSiege() { return ok(await sb.rpc("stocks_morts_siege")) as StockMortSiege[]; },
    async siegeRetirerProduit(nom, fournisseurId, consigne) {
      verifier(await sb.rpc("siege_retirer_produit", { p_nom: nom, p_fournisseur: fournisseurId, p_consigne: consigne }));
    },
    async siegeCloreProduit(id) { verifier(await sb.rpc("siege_clore_produit", { p_id: id })); },
    async livraisonsDuJour(): Promise<LivraisonJour[]> {
      const debut = new Date(); debut.setHours(0, 0, 0, 0);
      const l = ok(await sb.from("livraisons").select("id, at, t_camion, conforme, action, produits_refuses, photos_bl_suite, range_at, fournisseurs(nom)")
        .gte("at", debut.toISOString()).order("at")) as unknown as { id: string; at: string; t_camion: number; conforme: boolean; action: string | null;
          produits_refuses: string | null; photos_bl_suite: string[] | null; range_at: string | null; fournisseurs: { nom: string } | null }[];
      return l.map((x) => ({ id: x.id, fournisseur: x.fournisseurs?.nom ?? "Fournisseur", at: x.at, t_camion: Number(x.t_camion), conforme: x.conforme,
        action: x.action, produits_refuses: x.produits_refuses, pages: 1 + (x.photos_bl_suite?.length ?? 0), range_at: x.range_at }));
    },
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
          await inserer("huiles", op.lignes.map((l) => ({ ...l, non_utilisee: !!l.non_utilisee, litres: l.litres ?? null, ...commun, tache_id: op.tache_id ?? null })));
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
            photos_bl_suite: op.photos_bl_suite?.length ? op.photos_bl_suite : null, produits_refuses: op.produits_refuses ?? null,
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
        case "stock_mort":
          await inserer("inventaires_stock", [{ id: op.id, ...commun, produit_id: op.produit_id, reste: op.reste, quantite: op.quantite ?? null,
            dlc: op.dlc ?? null, photo: op.photo ?? null, decision: op.decision ?? null, transfert_vers: op.transfert_vers ?? null }]);
          break;
        case "utilisation":
          await inserer("utilisations", [{ id: op.id, ...commun, photo: op.photo, famille: op.famille, service: op.service }]);
          break;
      }
    },
  };
}
