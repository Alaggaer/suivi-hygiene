import { useEffect, useState } from "react";
import type { AlerteSiege, Api, FournisseurGestion, ReponseAlerte, SiteGestion, TypeAlerte } from "../types";
import { LIBELLE_ALERTE, useDocument } from "./AlertesProduit";

const ACTION: Record<string, string> = { reetiquete: "réétiqueté", isole: "mis de côté", repris: "repris par le fournisseur", detruit: "détruit" };
const quand = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const jour = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/**
 * Siège : envoyer une alerte produit (retrait fournisseur, prolongation de DDM) avec le document du fournisseur,
 * puis suivre restaurant par restaurant : lots trouvés, photos, ce qui a été fait, et qui n'a pas répondu.
 */
export function AlertesSiege({ api, onOuvrir }: { api: Api; onOuvrir: (siteId: string) => void }) {
  const [liste, setListe] = useState<AlerteSiege[] | null>(null);
  const [nouvelle, setNouvelle] = useState(false);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [aClore, setAClore] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const doc = useDocument(api);
  const charger = () => api.alertesSiege().then((l) => { setListe(l); setErreur(null); }).catch((e) => setErreur((e as Error).message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [api]);

  async function clore(id: string) {
    try { await api.siegeCloreAlerte(id); setAClore(null); await charger(); } catch (e) { setErreur((e as Error).message); }
  }

  return (
    <main className="s3-main">
      <div className="s3-titre"><h1>Alertes produit</h1><span className="hint">retraits demandés par un fournisseur, prolongations de DDM</span></div>
      {nouvelle
        ? <NouvelleAlerteForm api={api} onAnnuler={() => setNouvelle(false)} onEnvoyee={async () => { setNouvelle(false); await charger(); }} />
        : <button className="s3-verifier" onClick={() => setNouvelle(true)}>+ Nouvelle alerte</button>}
      {erreur && <p className="pill bad">{erreur}</p>}
      {!liste && !erreur && <p className="hint">Chargement…</p>}
      {liste && !liste.length && <p className="hint">Aucune alerte envoyée.</p>}
      {(liste ?? []).map((a) => {
        const repondu = a.sites.filter((s) => s.reponses.length).length, total = a.sites.length;
        const lots = a.sites.flatMap((s) => s.reponses.filter((r) => r.trouve));
        const enRetard = !a.clos_at && Date.parse(a.echeance) < Date.now() && repondu < total;
        return (
          <section key={a.id} className={`s3-bloc sm-produit al-siege ${a.type} ${a.clos_at ? "clos" : ""}`}>
            <div className="sm-tete">
              <div>
                <h2><span className={`al-type ${a.type}`}>{LIBELLE_ALERTE[a.type]}</span> {a.produit}</h2>
                <span className="hint">{[a.fournisseur, a.lots && `lots ${a.lots}`, `envoyée ${quand(a.cree_at)}`, a.clos_at && "close"].filter(Boolean).join(" · ")}</span>
              </div>
              <div className="sm-compte">
                <span className={`pill ${repondu === total ? "ok" : enRetard ? "bad" : "warn"}`}>{repondu}/{total} ont répondu</span>
                {lots.length > 0 && <span className="pill warn">{lots.length} lot{lots.length > 1 ? "s" : ""} trouvé{lots.length > 1 ? "s" : ""}</span>}
              </div>
            </div>
            {a.type === "prolongation" && a.ddm_nouvelle && <p className="al-ddm">DDM {a.ddm_origine && <><s>{jour(a.ddm_origine)}</s> → </>}<b>{jour(a.ddm_nouvelle)}</b></p>}
            {a.consigne && <p className="sm-consigne">Consigne : {a.consigne}</p>}
            <div className="sm-barre" role="img" aria-label={`${repondu} restaurants sur ${total} ont répondu`}>
              <span className="ok" style={{ width: `${(repondu / (total || 1)) * 100}%` }} />
            </div>
            <div className="carte-actions">
              {a.document && <button className="lien" onClick={() => doc.ouvrir(a.document!, a.document_type)}>Document du fournisseur</button>}
              <button className="lien" onClick={() => setOuvert(ouvert === a.id ? null : a.id)}>{ouvert === a.id ? "Masquer le détail" : "Détail par restaurant"}</button>
              {!a.clos_at && (aClore === a.id
                ? <><span className="hint">Plus aucun restaurant ne sera relancé.</span><button className="opt" onClick={() => clore(a.id)}>Confirmer la clôture</button><button className="lien" onClick={() => setAClore(null)}>Annuler</button></>
                : <button className="lien" onClick={() => setAClore(a.id)}>Clore l'alerte</button>)}
            </div>
            {ouvert === a.id && (
              <div className="table-scroll"><table className="tbl"><tbody>{a.sites.map((s) => (
                <tr key={s.site_id}>
                  <td><button className="lien" onClick={() => onOuvrir(s.site_id)}><b>{s.restaurant}</b></button></td>
                  <td>{!s.reponses.length ? <span className={`pill ${enRetard ? "bad" : "warn"}`}>{enRetard ? "sans réponse, relancé" : "en attente"}</span>
                    : s.reponses.map((r, i) => <Reponse key={i} r={r} ouvrir={(c) => doc.ouvrir(c, "image/webp")} />)}</td>
                </tr>
              ))}</tbody></table></div>
            )}
          </section>
        );
      })}
      <doc.Visionneuse />
    </main>
  );
}

function Reponse({ r, ouvrir }: { r: ReponseAlerte; ouvrir: (chemin: string) => void }) {
  return (
    <div className="al-rep">
      {r.trouve
        ? <><span className="pill warn">lot {r.lot}</span> {r.quantite} · {r.action && ACTION[r.action]}</>
        : <span className="pill ok">aucun lot</span>}
      <span className="hint"> · {r.par ?? ""} {quand(r.at)}</span>
      {r.photo && <button className="lien" onClick={() => ouvrir(r.photo!)}>Étiquette</button>}
      {r.photo_action && <button className="lien" onClick={() => ouvrir(r.photo_action!)}>{r.action === "reetiquete" ? "Réétiquetage" : "Preuve"}</button>}
    </div>
  );
}

function NouvelleAlerteForm({ api, onAnnuler, onEnvoyee }: { api: Api; onAnnuler: () => void; onEnvoyee: () => void }) {
  const [type, setType] = useState<TypeAlerte | null>(null);
  const [produit, setProduit] = useState(""); const [fournisseur, setFournisseur] = useState("");
  const [lots, setLots] = useState(""); const [consigne, setConsigne] = useState("");
  const [ddmOrigine, setDdmOrigine] = useState(""); const [ddmNouvelle, setDdmNouvelle] = useState(""); const [estDdm, setEstDdm] = useState(false);
  const [document, setDocument] = useState<File | null>(null);
  const [tous, setTous] = useState(true); const [choisis, setChoisis] = useState<string[]>([]);
  const [fournisseurs, setFournisseurs] = useState<FournisseurGestion[]>([]);
  const [sites, setSites] = useState<SiteGestion[]>([]);
  const [envoi, setEnvoi] = useState(false); const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    api.fournisseursGestion().then((l) => setFournisseurs(l.filter((f) => f.actif))).catch(() => {});
    api.sitesGestion().then((l) => setSites(l.filter((s) => s.actif))).catch(() => {});
  }, [api]);

  const manque = !type ? "Choisissez le type d'alerte" : produit.trim().length < 2 ? "Nom du produit"
    : type === "prolongation" && !ddmNouvelle ? "Nouvelle DDM"
    : type === "prolongation" && ddmOrigine && ddmNouvelle <= ddmOrigine ? "La nouvelle DDM doit être après l'ancienne"
    : type === "prolongation" && !estDdm ? "Confirmez qu'il s'agit d'une DDM"
    : type === "prolongation" && !document ? "Joignez le courrier du fournisseur"
    : !tous && !choisis.length ? "Choisissez les restaurants" : null;

  async function envoyer() {
    if (manque || !type) return;
    setEnvoi(true); setErreur(null);
    try {
      await api.siegeCreerAlerte({ type, produit: produit.trim(), fournisseur_id: fournisseur || null, lots, consigne,
        ddm_origine: type === "prolongation" && ddmOrigine ? ddmOrigine : null, ddm_nouvelle: type === "prolongation" ? ddmNouvelle : null,
        date_est_ddm: type === "prolongation" && estDdm, document, sites: tous ? null : choisis });
      onEnvoyee();
    } catch (e) { setErreur((e as Error).message); setEnvoi(false); }
  }

  return (
    <section className="s3-bloc al-form" aria-label="Nouvelle alerte">
      <h2>Nouvelle alerte produit</h2>
      <div className="opts">
        <button className={`opt ${type === "retrait" ? "sel" : ""}`} onClick={() => setType("retrait")}>Retrait demandé par le fournisseur</button>
        <button className={`opt ${type === "prolongation" ? "sel" : ""}`} onClick={() => setType("prolongation")}>Prolongation de DDM</button>
      </div>
      {type && <>
        <div className="sm-champs">
          <label className="champ-bloc">Produit<input className="champ" value={produit} onChange={(e) => setProduit(e.target.value)} placeholder="Ex. Cheddar tranché 1 kg" /></label>
          <label className="champ-bloc">Fournisseur
            <select className="champ" value={fournisseur} onChange={(e) => setFournisseur(e.target.value)}>
              <option value="">—</option>{fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
            </select>
          </label>
          <label className="champ-bloc">Lots concernés<input className="champ" value={lots} onChange={(e) => setLots(e.target.value)} placeholder="Ex. L2611A, L2611B (vide : tous)" /></label>
          {type === "prolongation" && <>
            <label className="champ-bloc">DDM d'origine<input className="champ" type="date" value={ddmOrigine} onChange={(e) => setDdmOrigine(e.target.value)} /></label>
            <label className="champ-bloc">Nouvelle DDM<input className="champ" type="date" value={ddmNouvelle} onChange={(e) => setDdmNouvelle(e.target.value)} /></label>
          </>}
          <label className="champ-bloc sm-large">Consigne aux restaurants (facultatif)<input className="champ" value={consigne} onChange={(e) => setConsigne(e.target.value)}
            placeholder={type === "retrait" ? "Ex. isoler, le livreur reprend jeudi" : "Ex. coller l'étiquette jointe sur chaque bidon"} /></label>
        </div>
        {type === "prolongation" && (
          <label className="g-case al-ddm-ok"><input type="checkbox" checked={estDdm} onChange={(e) => setEstDdm(e.target.checked)} />
            Je confirme qu'il s'agit d'une <b>DDM</b> (« à consommer de préférence avant »). Une DLC (« à consommer jusqu'au ») ne se prolonge jamais.</label>
        )}
        <label className="champ-bloc">Document du fournisseur (PDF ou photo){type === "retrait" ? " · conseillé" : " · obligatoire"}
          <input className="champ" type="file" accept="application/pdf,image/*" onChange={(e) => setDocument(e.target.files?.[0] ?? null)} aria-label="Document du fournisseur" />
        </label>
        <div className="champ-bloc">Restaurants
          <div className="opts">
            <button className={`opt ${tous ? "sel" : ""}`} onClick={() => setTous(true)}>Tous</button>
            <button className={`opt ${!tous ? "sel" : ""}`} onClick={() => setTous(false)}>Certains</button>
          </div>
          {!tous && <div className="g-jours">{sites.map((s) => {
            const on = choisis.includes(s.id);
            return <button key={s.id} type="button" className={`g-jour ${on ? "sel" : ""}`} aria-pressed={on}
              onClick={() => setChoisis(on ? choisis.filter((x) => x !== s.id) : [...choisis, s.id])}>{s.nom}</button>;
          })}</div>}
        </div>
        <p className="hint">Les restaurants sont prévenus tout de suite. Sans réponse sous {type === "retrait" ? "4 h" : "24 h"}, vous recevez un e-mail.</p>
      </>}
      {erreur && <p className="pill bad">{erreur}</p>}
      <div className="opts">
        <button className="opt" onClick={onAnnuler}>Annuler</button>
        <button className="s3-verifier" disabled={!!manque || envoi} onClick={envoyer}>{envoi ? "Envoi…" : manque ?? "Envoyer aux restaurants"}</button>
      </div>
    </section>
  );
}
