import { ImportTableau } from "./ImportTableau";
import { useEffect, useState } from "react";
import type {
  Api, Employe, EnceinteGestion, FournisseurGestion, FriteuseGestion, ModeleTache, ProduitLivre, RoleEmploye, SiteGestion, Tablette,
} from "../types";

/**
 * Gestion par le siège : restaurants (horaires), compte de la tablette, employés et codes PIN,
 * enceintes, friteuses, tâches du jour ; et la liste des fournisseurs du groupe.
 * Rien n'est jamais supprimé : on désactive (l'historique reste lisible et signé).
 */
type Choix = { type: "site"; id: string } | { type: "nouveau" } | { type: "fournisseurs" } | { type: "import" };
type Onglet = "infos" | "employes" | "enceintes" | "friteuses" | "taches" | "tablette";

const ROLES: { cle: RoleEmploye; libelle: string }[] = [{ cle: "equipe", libelle: "Équipe" }, { cle: "chef", libelle: "Chef" }, { cle: "responsable", libelle: "Responsable de site" }];
const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const hhmm = (t: string) => t.slice(0, 5);

export function Gestion({ api }: { api: Api }) {
  const [sites, setSites] = useState<SiteGestion[] | null>(null);
  const [choix, setChoix] = useState<Choix | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = () => api.sitesGestion().then((l) => { setSites(l); setChoix((c) => c ?? (l[0] ? { type: "site", id: l[0].id } : { type: "nouveau" })); })
    .catch((e) => setErreur((e as Error).message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [api]);

  if (erreur) return <p className="pill bad">{erreur}</p>;
  if (!sites) return <p className="hint">Chargement…</p>;
  const site = choix?.type === "site" ? sites.find((s) => s.id === choix.id) : undefined;

  return (
    <main className="s3-main">
      <div className="s3-titre"><h1>Gestion</h1><span className="hint">restaurants, équipes et équipements · rien n'est supprimé, on désactive</span></div>
      <div className="g-cadre">
        <nav className="g-liste" aria-label="Restaurants">
          {sites.map((s) => (
            <button key={s.id} className={`g-item ${choix?.type === "site" && choix.id === s.id ? "sel" : ""} ${s.actif ? "" : "inactif"}`} onClick={() => setChoix({ type: "site", id: s.id })}>
              <b>{s.nom}</b><span>{s.ville}{s.actif ? "" : " · désactivé"}</span>
            </button>
          ))}
          <button className={`g-item ajout ${choix?.type === "nouveau" ? "sel" : ""}`} onClick={() => setChoix({ type: "nouveau" })}>+ Nouveau restaurant</button>
          <button className={`g-item ajout ${choix?.type === "import" ? "sel" : ""}`} onClick={() => setChoix({ type: "import" })}>Importer le tableau</button>
          <button className={`g-item ${choix?.type === "fournisseurs" ? "sel" : ""}`} onClick={() => setChoix({ type: "fournisseurs" })}><b>Fournisseurs</b><span>liste du groupe</span></button>
        </nav>
        <div className="g-contenu">
          {choix?.type === "nouveau" && <NouveauRestaurant api={api} onCree={async (id) => { await charger(); setChoix({ type: "site", id }); }} />}
          {choix?.type === "fournisseurs" && <Fournisseurs api={api} />}
          {choix?.type === "import" && <ImportTableau api={api} onFini={() => api.sitesGestion().then(setSites).catch(() => {})} />}
          {site && <FicheGestion key={site.id} api={api} site={site} onSiteModifie={charger} />}
        </div>
      </div>
    </main>
  );
}

/* ---------- Un restaurant ---------- */

function FicheGestion({ api, site, onSiteModifie }: { api: Api; site: SiteGestion; onSiteModifie: () => void }) {
  const [onglet, setOnglet] = useState<Onglet>("employes");
  const ONGLETS: [Onglet, string][] = [["employes", "Employés"], ["enceintes", "Enceintes"], ["friteuses", "Friteuses"], ["taches", "Tâches du jour"], ["tablette", "Tablette"], ["infos", "Restaurant"]];
  return (
    <section className="s3-bloc">
      <h2>{site.nom} <small>{site.ville}</small></h2>
      <div className="s3-filtres g-onglets" role="tablist">
        {ONGLETS.map(([k, l]) => <button key={k} role="tab" className={`opt ${onglet === k ? "sel" : ""}`} onClick={() => setOnglet(k)}>{l}</button>)}
      </div>
      {onglet === "employes" && <Employes api={api} siteId={site.id} />}
      {onglet === "enceintes" && <Enceintes api={api} siteId={site.id} />}
      {onglet === "friteuses" && <Friteuses api={api} siteId={site.id} />}
      {onglet === "taches" && <Taches api={api} siteId={site.id} />}
      {onglet === "tablette" && <CompteTablette api={api} site={site} />}
      {onglet === "infos" && <InfosRestaurant api={api} site={site} onModifie={onSiteModifie} />}
    </section>
  );
}

function useAction() {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const faire = async (f: () => Promise<unknown>, message?: string) => {
    setEnCours(true); setErreur(null); setOk(null);
    try { await f(); if (message) setOk(message); return true; }
    catch (e) { setErreur((e as Error).message); return false; }
    finally { setEnCours(false); }
  };
  const Retour = () => <>{erreur && <p className="pill bad">{erreur}</p>}{ok && <p className="pill ok">{ok}</p>}</>;
  return { enCours, faire, Retour };
}

/* Employés et PIN */
function Employes({ api, siteId }: { api: Api; siteId: string }) {
  const [liste, setListe] = useState<Employe[] | null>(null);
  const [nom, setNom] = useState(""); const [role, setRole] = useState<RoleEmploye>("equipe");
  const [pin, setPin] = useState<{ nom: string; pin: string } | null>(null);
  const { enCours, faire, Retour } = useAction();
  const charger = () => api.employesSite(siteId).then(setListe);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [siteId]);

  return (
    <div className="g-section">
      <p className="hint">Chaque employé se connecte sur la tablette en touchant son nom, puis son code à 4 chiffres. Le code ne s'affiche qu'une fois : notez-le pour le lui donner.</p>
      <Retour />
      {pin && (
        <div className="g-pin" role="alert">
          <span>Code de <b>{pin.nom}</b></span><b className="g-pin-code">{pin.pin}</b>
          <span className="hint">Notez-le maintenant : il ne sera plus affiché.</span>
          <button className="opt" onClick={() => setPin(null)}>C'est noté</button>
        </div>
      )}
      <div className="table-scroll"><table className="tbl g-table"><thead><tr><th>Nom</th><th>Rôle</th><th>État</th><th /></tr></thead><tbody>
        {(liste ?? []).map((e) => (
          <tr key={e.id} className={e.actif ? "" : "inactif"}>
            <td><b>{e.nom}</b></td>
            <td><select className="champ" value={e.role} disabled={enCours} aria-label={`Rôle de ${e.nom}`}
              onChange={(x) => faire(async () => { await api.siegeModifierEmploye(e.id, e.nom, x.target.value as RoleEmploye, e.actif); await charger(); })}>
              {ROLES.map((r) => <option key={r.cle} value={r.cle}>{r.libelle}</option>)}
            </select></td>
            <td>{e.actif ? <span className="pill ok">actif</span> : <span className="pill none">désactivé</span>}</td>
            <td className="g-actions">
              {e.actif && <button className="lien" disabled={enCours} onClick={() => faire(async () => setPin({ nom: e.nom, pin: await api.siegeNouveauPin(e.id) }))}>Nouveau code</button>}
              <button className="lien" disabled={enCours} onClick={() => faire(async () => { await api.siegeModifierEmploye(e.id, e.nom, e.role, !e.actif); await charger(); })}>{e.actif ? "Désactiver" : "Réactiver"}</button>
            </td>
          </tr>
        ))}
      </tbody></table></div>
      <div className="g-ajout">
        <input className="champ" value={nom} onChange={(x) => setNom(x.target.value)} placeholder="Prénom et nom" aria-label="Nom du nouvel employé" />
        <select className="champ" value={role} onChange={(x) => setRole(x.target.value as RoleEmploye)} aria-label="Rôle">{ROLES.map((r) => <option key={r.cle} value={r.cle}>{r.libelle}</option>)}</select>
        <button className="s3-verifier" disabled={nom.trim().length < 2 || enCours}
          onClick={() => faire(async () => { const p = await api.siegeAjouterEmploye(siteId, nom.trim(), role); setPin({ nom: nom.trim(), pin: p }); setNom(""); await charger(); })}>Ajouter</button>
      </div>
    </div>
  );
}

/* Enceintes */
function Enceintes({ api, siteId }: { api: Api; siteId: string }) {
  const [liste, setListe] = useState<EnceinteGestion[] | null>(null);
  const { enCours, faire, Retour } = useAction();
  const charger = () => api.referentielSite(siteId).then((r) => setListe(r.enceintes));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [siteId]);
  const enregistrer = (l: EnceinteGestion) => faire(async () => { await api.siegeEnregistrer("enceintes", { ...l }); await charger(); }, "Enregistré");
  const nouvelle = () => setListe([...(liste ?? []), { site_id: siteId, nom: "", t_max: 4, ordre: (liste?.length ?? 0) + 1, actif: true }]);
  return (
    <div className="g-section">
      <p className="hint">Température maximale : +3 °C pour une chambre froide positive, +4 °C pour un frigo, −18 °C pour un froid négatif. Elle s'applique aux relevés suivants.</p>
      <Retour />
      <div className="table-scroll"><table className="tbl g-table"><thead><tr><th>Ordre</th><th>Enceinte</th><th>T° max (°C)</th><th>État</th><th /></tr></thead><tbody>
        {(liste ?? []).map((e, i) => (
          <LigneEditable key={e.id ?? `n${i}`} valeur={e} enCours={enCours} onEnregistrer={enregistrer} valide={(x) => x.nom.trim().length >= 2 && !Number.isNaN(x.t_max) && x.t_max >= -40 && x.t_max <= 15}>
            {(x, set) => <>
              <td><input className="champ g-court" type="number" value={x.ordre} onChange={(v) => set({ ...x, ordre: Number(v.target.value) })} aria-label="Ordre" /></td>
              <td><input className="champ" value={x.nom} onChange={(v) => set({ ...x, nom: v.target.value })} placeholder="Ex. Frigo poste chaud" aria-label="Nom" /></td>
              <td><input className="champ g-court" type="number" step="0.5" value={x.t_max} onChange={(v) => set({ ...x, t_max: Number(v.target.value) })} aria-label="Température maximale" /></td>
              <td><label className="g-case"><input type="checkbox" checked={x.actif} onChange={(v) => set({ ...x, actif: v.target.checked })} /> active</label></td>
            </>}
          </LigneEditable>
        ))}
      </tbody></table></div>
      <button className="opt" disabled={!liste} onClick={nouvelle}>+ Ajouter une enceinte</button>
    </div>
  );
}

/* Friteuses */
function Friteuses({ api, siteId }: { api: Api; siteId: string }) {
  const [liste, setListe] = useState<FriteuseGestion[] | null>(null);
  const { enCours, faire, Retour } = useAction();
  const charger = () => api.referentielSite(siteId).then((r) => setListe(r.friteuses));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [siteId]);
  const enregistrer = (l: FriteuseGestion) => faire(async () => { await api.siegeEnregistrer("friteuses", { ...l }); await charger(); }, "Enregistré");
  return (
    <div className="g-section">
      <Retour />
      <div className="table-scroll"><table className="tbl g-table"><thead><tr><th>Friteuse</th><th>Capacité (L)</th><th>État</th><th /></tr></thead><tbody>
        {(liste ?? []).map((f, i) => (
          <LigneEditable key={f.id ?? `n${i}`} valeur={f} enCours={enCours} onEnregistrer={enregistrer} valide={(x) => x.nom.trim().length >= 2 && x.litres > 0 && x.litres <= 99}>
            {(x, set) => <>
              <td><input className="champ" value={x.nom} onChange={(v) => set({ ...x, nom: v.target.value })} aria-label="Nom" /></td>
              <td><input className="champ g-court" type="number" value={x.litres || ""} onChange={(v) => set({ ...x, litres: Number(v.target.value) })} aria-label="Capacité en litres" /></td>
              <td><label className="g-case"><input type="checkbox" checked={x.actif} onChange={(v) => set({ ...x, actif: v.target.checked })} /> active</label></td>
            </>}
          </LigneEditable>
        ))}
      </tbody></table></div>
      <button className="opt" disabled={!liste} onClick={() => setListe([...(liste ?? []), { site_id: siteId, nom: `Friteuse ${(liste?.length ?? 0) + 1}`, litres: 0, actif: true }])}>+ Ajouter une friteuse</button>
    </div>
  );
}

/* Tâches du jour (modèles) */
function Taches({ api, siteId }: { api: Api; siteId: string }) {
  const [liste, setListe] = useState<ModeleTache[] | null>(null);
  const { enCours, faire, Retour } = useAction();
  const charger = () => api.referentielSite(siteId).then((r) => setListe(r.modeles));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [siteId]);
  const enregistrer = (l: ModeleTache) => faire(async () => { await api.siegeEnregistrer("taches_modeles", { ...l }); await charger(); }, "Enregistré : appliqué aux tâches de demain");
  return (
    <div className="g-section">
      <p className="hint">Les tâches de chaque jour sont créées la veille au soir à partir de cette liste. Un changement s'applique donc à partir de demain.</p>
      <Retour />
      <div className="table-scroll"><table className="tbl g-table"><thead><tr><th>Tâche</th><th>Avant</th><th>Jours</th><th>État</th><th /></tr></thead><tbody>
        {(liste ?? []).map((m, i) => (
          <LigneEditable key={m.id ?? `n${i}`} valeur={m} enCours={enCours} onEnregistrer={enregistrer} valide={(x) => x.titre.trim().length >= 3 && x.jours.length > 0}>
            {(x, set) => <>
              <td><input className="champ" value={x.titre} onChange={(v) => set({ ...x, titre: v.target.value })} aria-label="Titre" /></td>
              <td><input className="champ g-court" type="time" value={hhmm(x.heure_limite)} onChange={(v) => set({ ...x, heure_limite: v.target.value })} aria-label="Heure limite" /></td>
              <td className="g-jours">{JOURS.map((j, k) => (
                <button key={j} type="button" className={`g-jour ${x.jours.includes(k + 1) ? "sel" : ""}`} aria-pressed={x.jours.includes(k + 1)}
                  onClick={() => set({ ...x, jours: x.jours.includes(k + 1) ? x.jours.filter((d) => d !== k + 1) : [...x.jours, k + 1].sort() })}>{j}</button>
              ))}</td>
              <td><label className="g-case"><input type="checkbox" checked={x.actif} onChange={(v) => set({ ...x, actif: v.target.checked })} /> active</label></td>
            </>}
          </LigneEditable>
        ))}
      </tbody></table></div>
      <button className="opt" disabled={!liste} onClick={() => setListe([...(liste ?? []), { site_id: siteId, type: "autre", titre: "", heure_limite: "15:00", jours: [1, 2, 3, 4, 5, 6, 7], actif: true }])}>+ Ajouter une tâche</button>
    </div>
  );
}

/* Compte de la tablette */
function CompteTablette({ api, site }: { api: Api; site: SiteGestion }) {
  const [liste, setListe] = useState<Tablette[] | null>(null);
  const [email, setEmail] = useState(`tablette.${site.nom.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "")}@hollysdiner.fr`);
  const [mdp, setMdp] = useState("");
  const [nouveauPour, setNouveauPour] = useState<string | null>(null);
  const { enCours, faire, Retour } = useAction();
  const charger = () => api.tablettes(site.id).then(setListe).catch(() => setListe([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [site.id]);
  return (
    <div className="g-section">
      <p className="hint">La tablette du restaurant s'active une seule fois avec cet e-mail et ce mot de passe. Choisissez un mot de passe d'au moins 10 caractères, rangez-le dans votre gestionnaire de mots de passe : il ne s'affiche jamais.</p>
      <Retour />
      {(liste ?? []).map((t) => (
        <div key={t.id} className="g-tablette">
          <span><b>{t.email}</b><br /><span className="hint">{t.derniere_connexion ? `dernière activation ${new Date(t.derniere_connexion).toLocaleDateString("fr-FR")}` : "jamais activée"}</span></span>
          {nouveauPour === t.id
            ? <span className="g-ajout"><input className="champ" type="password" autoComplete="new-password" value={mdp} onChange={(v) => setMdp(v.target.value)} placeholder="Nouveau mot de passe" aria-label="Nouveau mot de passe" />
                <button className="s3-verifier" disabled={mdp.length < 10 || enCours} onClick={() => faire(async () => { await api.motDePasseTablette(t.id, mdp); setMdp(""); setNouveauPour(null); }, "Mot de passe changé : réactivez la tablette avec le nouveau")}>Enregistrer</button></span>
            : <button className="lien" onClick={() => { setNouveauPour(t.id); setMdp(""); }}>Changer le mot de passe</button>}
        </div>
      ))}
      {liste && !liste.length && (
        <div className="g-ajout">
          <input className="champ" type="email" value={email} onChange={(v) => setEmail(v.target.value)} aria-label="E-mail du compte tablette" />
          <input className="champ" type="password" autoComplete="new-password" value={mdp} onChange={(v) => setMdp(v.target.value)} placeholder="Mot de passe (10 caractères ou plus)" aria-label="Mot de passe" />
          <button className="s3-verifier" disabled={!/^\S+@\S+\.\S+$/.test(email) || mdp.length < 10 || enCours}
            onClick={() => faire(async () => { await api.creerTablette(site.id, email.trim(), mdp); setMdp(""); await charger(); }, "Compte tablette créé")}>Créer le compte</button>
        </div>
      )}
    </div>
  );
}

/* Restaurant : nom, ville, horaires, activation */
function InfosRestaurant({ api, site, onModifie }: { api: Api; site: SiteGestion; onModifie: () => void }) {
  const [x, setX] = useState(site);
  const { enCours, faire, Retour } = useAction();
  const change = JSON.stringify(x) !== JSON.stringify(site);
  return (
    <div className="g-section g-form">
      <Retour />
      <label className="champ-bloc">Nom<input className="champ" value={x.nom} onChange={(v) => setX({ ...x, nom: v.target.value.toUpperCase() })} /></label>
      <label className="champ-bloc">Ville<input className="champ" value={x.ville} onChange={(v) => setX({ ...x, ville: v.target.value.toUpperCase() })} /></label>
      <label className="champ-bloc">Ouverture<input className="champ g-court" type="time" value={hhmm(x.ouverture)} onChange={(v) => setX({ ...x, ouverture: v.target.value })} /></label>
      <label className="champ-bloc">Début du service du soir<input className="champ g-court" type="time" value={hhmm(x.service_soir)} onChange={(v) => setX({ ...x, service_soir: v.target.value })} /></label>
      <label className="g-case"><input type="checkbox" checked={x.actif} onChange={(v) => setX({ ...x, actif: v.target.checked })} /> Restaurant actif (décoché : plus de tâches ni d'alertes, l'historique reste)</label>
      <button className="s3-verifier" disabled={!change || x.nom.trim().length < 2 || enCours}
        onClick={() => faire(async () => { await api.siegeEnregistrer("sites", { id: x.id, nom: x.nom.trim(), ville: x.ville.trim(), ouverture: x.ouverture, service_soir: x.service_soir, actif: x.actif }); onModifie(); }, "Enregistré")}>Enregistrer</button>
    </div>
  );
}

function NouveauRestaurant({ api, onCree }: { api: Api; onCree: (id: string) => void }) {
  const [nom, setNom] = useState(""); const [ville, setVille] = useState("");
  const [ouv, setOuv] = useState("09:00"); const [soir, setSoir] = useState("18:45");
  const { enCours, faire, Retour } = useAction();
  return (
    <section className="s3-bloc g-form">
      <h2>Nouveau restaurant</h2>
      <p className="hint">Il est créé avec les tâches habituelles (relevés matin et soir, huile, DLC le lundi, hottes le vendredi). Ajoutez ensuite ses employés, ses enceintes, ses friteuses et le compte de sa tablette.</p>
      <Retour />
      <label className="champ-bloc">Nom<input className="champ" value={nom} onChange={(v) => setNom(v.target.value.toUpperCase())} placeholder="Ex. SEATTLE" /></label>
      <label className="champ-bloc">Ville<input className="champ" value={ville} onChange={(v) => setVille(v.target.value.toUpperCase())} /></label>
      <label className="champ-bloc">Ouverture<input className="champ g-court" type="time" value={ouv} onChange={(v) => setOuv(v.target.value)} /></label>
      <label className="champ-bloc">Début du service du soir<input className="champ g-court" type="time" value={soir} onChange={(v) => setSoir(v.target.value)} /></label>
      <button className="s3-verifier" disabled={nom.trim().length < 2 || ville.trim().length < 2 || enCours}
        onClick={() => faire(async () => onCree(await api.siegeCreerRestaurant(nom.trim(), ville.trim(), ouv, soir)))}>Créer le restaurant</button>
    </section>
  );
}

/* Fournisseurs du groupe */
const PRODUITS: { cle: ProduitLivre; libelle: string }[] = [{ cle: "frais", libelle: "frais" }, { cle: "sec", libelle: "sec" }, { cle: "surgele", libelle: "surgelés" }];
function Fournisseurs({ api }: { api: Api }) {
  const [liste, setListe] = useState<FournisseurGestion[] | null>(null);
  const { enCours, faire, Retour } = useAction();
  const charger = () => api.fournisseursGestion().then(setListe);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, []);
  const enregistrer = (f: FournisseurGestion) => faire(async () => { await api.siegeEnregistrer("fournisseurs", { ...f }); await charger(); }, "Enregistré");
  return (
    <section className="s3-bloc">
      <h2>Fournisseurs du groupe</h2>
      <p className="hint">Ce qu'ils livrent décide des températures demandées à la réception ; « viande » fait demander l'origine ; les jours de livraison les mettent en tête de liste ces jours-là.</p>
      <Retour />
      <div className="table-scroll"><table className="tbl g-table"><thead><tr><th>Fournisseur</th><th>Livre</th><th>Viande</th><th>Jours de livraison</th><th>État</th><th /></tr></thead><tbody>
        {(liste ?? []).map((f, i) => (
          <LigneEditable key={f.id ?? `n${i}`} valeur={f} enCours={enCours} onEnregistrer={enregistrer} valide={(x) => x.nom.trim().length >= 2}>
            {(x, set) => <>
              <td><input className="champ" value={x.nom} onChange={(v) => set({ ...x, nom: v.target.value })} aria-label="Nom" /></td>
              <td className="g-jours">{PRODUITS.map((p) => {
                const on = !!x.produits?.includes(p.cle);
                return <button key={p.cle} type="button" className={`g-jour ${on ? "sel" : ""}`} aria-pressed={on}
                  onClick={() => { const l = on ? (x.produits ?? []).filter((y) => y !== p.cle) : [...(x.produits ?? []), p.cle]; set({ ...x, produits: l.length ? l : null }); }}>{p.libelle}</button>;
              })}</td>
              <td><label className="g-case"><input type="checkbox" checked={x.viande} onChange={(v) => set({ ...x, viande: v.target.checked })} /> oui</label></td>
              <td className="g-jours">{JOURS.map((j, k) => {
                const on = !!x.jours_livraison?.includes(k + 1);
                return <button key={j} type="button" className={`g-jour ${on ? "sel" : ""}`} aria-pressed={on}
                  onClick={() => { const l = on ? (x.jours_livraison ?? []).filter((d) => d !== k + 1) : [...(x.jours_livraison ?? []), k + 1].sort(); set({ ...x, jours_livraison: l.length ? l : null }); }}>{j}</button>;
              })}</td>
              <td><label className="g-case"><input type="checkbox" checked={x.actif} onChange={(v) => set({ ...x, actif: v.target.checked })} /> actif</label></td>
            </>}
          </LigneEditable>
        ))}
      </tbody></table></div>
      <button className="opt" disabled={!liste} onClick={() => setListe([...(liste ?? []), { nom: "", viande: false, produits: null, jours_livraison: null, actif: true }])}>+ Ajouter un fournisseur</button>
    </section>
  );
}

/** Une ligne de tableau modifiable, avec son bouton Enregistrer (actif seulement s'il y a un changement valable). */
function LigneEditable<T>({ valeur, enCours, onEnregistrer, valide, children }: {
  valeur: T; enCours: boolean; onEnregistrer: (v: T) => void; valide: (v: T) => boolean; children: (v: T, set: (v: T) => void) => React.ReactNode;
}) {
  const [x, setX] = useState(valeur);
  useEffect(() => setX(valeur), [valeur]);
  const change = JSON.stringify(x) !== JSON.stringify(valeur) || !(valeur as { id?: string }).id;
  return (
    <tr className={(x as { actif?: boolean }).actif === false ? "inactif" : ""}>
      {children(x, setX)}
      <td>{change && <button className="opt sel" disabled={!valide(x) || enCours} onClick={() => onEnregistrer(x)}>Enregistrer</button>}</td>
    </tr>
  );
}
