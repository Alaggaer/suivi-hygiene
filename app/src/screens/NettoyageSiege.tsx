import { useEffect, useState } from "react";
import type { Api, ElementNettoyage, FrequenceNettoyage, NettoyageSiege, ProduitEntretien, SiteGestion } from "../types";
import { useDocument } from "./AlertesProduit";

const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const hhmm = (t: string) => t.slice(0, 5);
const auj = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
export const frequenceLisible = (e: Pick<ElementNettoyage, "frequence" | "jour">) =>
  e.frequence === "jour" ? "chaque jour" : e.frequence === "semaine" ? `chaque ${["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][(e.jour ?? 1) - 1]}` : `le ${e.jour} du mois`;

/** Siège : plan de nettoyage du groupe, produits d'entretien (FT, FDS) et suivi de la réalisation. */
export function NettoyageSiegeVue({ api, onOuvrir }: { api: Api; onOuvrir: (siteId: string) => void }) {
  const [onglet, setOnglet] = useState<"suivi" | "plan" | "produits">("suivi");
  return (
    <main className="s3-main">
      <div className="s3-titre"><h1>Plan de nettoyage</h1><span className="hint">un plan pour tout le groupe · tâches créées chaque nuit pour chaque restaurant</span></div>
      <div className="s3-filtres" role="tablist">
        {([["suivi", "Suivi"], ["plan", "Plan"], ["produits", "Produits d'entretien"]] as const).map(([k, l]) => (
          <button key={k} role="tab" className={`opt ${onglet === k ? "sel" : ""}`} onClick={() => setOnglet(k)}>{l}</button>
        ))}
      </div>
      {onglet === "suivi" && <Suivi api={api} onOuvrir={onOuvrir} />}
      {onglet === "plan" && <Plan api={api} />}
      {onglet === "produits" && <Produits api={api} />}
    </main>
  );
}

function Suivi({ api, onOuvrir }: { api: Api; onOuvrir: (id: string) => void }) {
  const [jour, setJour] = useState(auj());
  const [l, setL] = useState<NettoyageSiege[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const doc = useDocument(api);
  useEffect(() => { setL(null); api.nettoyageSiege(jour).then(setL).catch((e) => setErreur((e as Error).message)); }, [api, jour]);
  const maintenant = Date.now();
  return (
    <section className="s3-bloc">
      <label className="champ-bloc pn-jour">Journée du<input className="champ" type="date" value={jour} max={auj()} onChange={(e) => e.target.value && setJour(e.target.value)} /></label>
      {erreur && <p className="pill bad">{erreur}</p>}
      {!l && !erreur && <p className="hint">Chargement…</p>}
      {l && <div className="table-scroll"><table className="tbl pn-suivi"><thead><tr><th>Restaurant</th><th>Réalisation</th><th>Par zone</th></tr></thead><tbody>
        {l.map((r) => {
          const total = r.taches.reduce((a, t) => a + t.total, 0), faits = r.taches.reduce((a, t) => a + t.faits, 0);
          const enRetard = r.taches.some((t) => !t.faite_at && Date.parse(t.echeance) < maintenant);
          return (
            <tr key={r.site_id}>
              <td><button className="lien" onClick={() => onOuvrir(r.site_id)}><b>{r.restaurant}</b></button></td>
              <td>{total ? <span className={`pill ${faits === total ? "ok" : enRetard ? "bad" : "warn"}`}>{faits}/{total}</span> : <span className="hint">rien de prévu</span>}</td>
              <td className="pn-zones">{r.taches.map((t) => (
                <span key={t.id} className={`pn-zone ${t.faite_at ? "ok" : Date.parse(t.echeance) < maintenant ? "bad" : ""}`}>
                  {t.zone} {heure(t.echeance)} · {t.faits}/{t.total}
                  {t.photos.map((p, i) => <button key={i} className="lien" title={`${p.element} · ${p.par ?? ""}`} onClick={() => doc.ouvrir(p.photo, "image/webp")}>photo</button>)}
                </span>
              ))}</td>
            </tr>
          );
        })}
      </tbody></table></div>}
      <doc.Visionneuse />
    </section>
  );
}

function useAction() {
  const [enCours, setEnCours] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const faire = async (f: () => Promise<unknown>, ok = "Enregistré") => {
    setEnCours(true); setMsg(null);
    try { await f(); setMsg({ ok: true, t: ok }); } catch (e) { setMsg({ ok: false, t: (e as Error).message }); } finally { setEnCours(false); }
  };
  return { enCours, faire, msg };
}

function Plan({ api }: { api: Api }) {
  const [plan, setPlan] = useState<ElementNettoyage[] | null>(null);
  const [produits, setProduits] = useState<ProduitEntretien[]>([]);
  const [sites, setSites] = useState<SiteGestion[]>([]);
  const [edite, setEdite] = useState<ElementNettoyage | null>(null);
  const { enCours, faire, msg } = useAction();
  const charger = () => api.planNettoyage().then(setPlan);
  useEffect(() => {
    charger(); api.produitsEntretien().then(setProduits).catch(() => {}); api.sitesGestion().then((l) => setSites(l.filter((s) => s.actif))).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  const zones = [...new Set((plan ?? []).map((e) => e.zone))];
  const nom = (id: string | null) => produits.find((p) => p.id === id)?.nom;

  return (
    <section className="s3-bloc">
      <p className="hint">Chaque nuit, les éléments prévus le lendemain deviennent une tâche par zone et par heure dans chaque restaurant. Un changement s'applique donc à partir de demain.</p>
      {msg && <p className={`pill ${msg.ok ? "ok" : "bad"}`}>{msg.t}</p>}
      {edite
        ? <FormElement e={edite} zones={zones} produits={produits} sites={sites} enCours={enCours} onAnnuler={() => setEdite(null)}
            onEnregistrer={(x) => faire(async () => { await api.siegeEnregistrer("nettoyage_elements", { ...x }); setEdite(null); await charger(); })} />
        : <button className="s3-verifier" onClick={() => setEdite({ zone: zones[0] ?? "Cuisine", element: "", frequence: "jour", jour: null, heure_limite: "23:30", produit_id: null,
            methode: null, photo_obligatoire: false, sites: null, ordre: 99, actif: true })}>+ Ajouter un élément</button>}
      {!plan && <p className="hint">Chargement…</p>}
      {zones.map((z) => (
        <div key={z} className="pn-bloc-zone">
          <h3>{z}</h3>
          <div className="table-scroll"><table className="tbl"><tbody>
            {plan!.filter((e) => e.zone === z).map((e) => (
              <tr key={e.id} className={e.actif ? "" : "inactif"}>
                <td><b>{e.element}</b>{e.methode && <><br /><span className="hint">{e.methode}</span></>}</td>
                <td>{frequenceLisible(e)}<br /><span className="hint">avant {hhmm(e.heure_limite)}</span></td>
                <td>{nom(e.produit_id) ?? <span className="hint">—</span>}</td>
                <td>{e.photo_obligatoire && <span className="pill warn">photo</span>} {e.sites && <span className="pill none">{e.sites.length} resto{e.sites.length > 1 ? "s" : ""}</span>} {!e.actif && <span className="pill none">désactivé</span>}</td>
                <td><button className="lien" onClick={() => setEdite({ ...e, heure_limite: hhmm(e.heure_limite) })}>Modifier</button></td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      ))}
    </section>
  );
}

function FormElement({ e, zones, produits, sites, enCours, onAnnuler, onEnregistrer }: {
  e: ElementNettoyage; zones: string[]; produits: ProduitEntretien[]; sites: SiteGestion[]; enCours: boolean;
  onAnnuler: () => void; onEnregistrer: (x: ElementNettoyage) => void;
}) {
  const [x, setX] = useState(e);
  const manque = x.zone.trim().length < 2 ? "Zone" : x.element.trim().length < 2 ? "Élément à nettoyer"
    : x.frequence !== "jour" && !x.jour ? "Choisissez le jour" : x.sites && !x.sites.length ? "Choisissez les restaurants" : null;
  const freq = (f: FrequenceNettoyage) => setX({ ...x, frequence: f, jour: f === "jour" ? null : f === "semaine" ? 1 : 1 });
  return (
    <section className="al-form pn-form" aria-label="Élément du plan">
      <div className="sm-champs">
        <label className="champ-bloc">Zone<input className="champ" list="pn-zones" value={x.zone} onChange={(v) => setX({ ...x, zone: v.target.value })} />
          <datalist id="pn-zones">{[...new Set([...zones, "Cuisine", "Plonge", "Réserve", "Salle", "Sanitaires"])].map((z) => <option key={z} value={z} />)}</datalist></label>
        <label className="champ-bloc">Élément à nettoyer<input className="champ" value={x.element} onChange={(v) => setX({ ...x, element: v.target.value })} placeholder="Ex. Hotte et filtres" /></label>
        <label className="champ-bloc">Avant<input className="champ g-court" type="time" value={hhmm(x.heure_limite)} onChange={(v) => setX({ ...x, heure_limite: v.target.value })} /></label>
        <label className="champ-bloc">Produit
          <select className="champ" value={x.produit_id ?? ""} onChange={(v) => setX({ ...x, produit_id: v.target.value || null })}>
            <option value="">—</option>{produits.filter((p) => p.actif).map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select></label>
        <label className="champ-bloc sm-large">Méthode (facultatif)<input className="champ" value={x.methode ?? ""} onChange={(v) => setX({ ...x, methode: v.target.value || null })} placeholder="Ex. démonter, tremper, rincer, sécher" /></label>
      </div>
      <div className="champ-bloc">Fréquence
        <div className="opts">
          {(["jour", "semaine", "mois"] as const).map((f) => <button key={f} className={`opt ${x.frequence === f ? "sel" : ""}`} onClick={() => freq(f)}>{{ jour: "Chaque jour", semaine: "Chaque semaine", mois: "Chaque mois" }[f]}</button>)}
        </div>
        {x.frequence === "semaine" && <div className="g-jours">{JOURS.map((j, k) => <button key={j} type="button" className={`g-jour ${x.jour === k + 1 ? "sel" : ""}`} onClick={() => setX({ ...x, jour: k + 1 })}>{j}</button>)}</div>}
        {x.frequence === "mois" && <label className="champ-bloc">Jour du mois (1 à 28)<input className="champ g-court" type="number" min={1} max={28} value={x.jour ?? 1}
          onChange={(v) => setX({ ...x, jour: Math.min(28, Math.max(1, Number(v.target.value) || 1)) })} /></label>}
      </div>
      <label className="g-case"><input type="checkbox" checked={x.photo_obligatoire} onChange={(v) => setX({ ...x, photo_obligatoire: v.target.checked })} /> Photo obligatoire</label>
      <div className="champ-bloc">Restaurants
        <div className="opts">
          <button className={`opt ${!x.sites ? "sel" : ""}`} onClick={() => setX({ ...x, sites: null })}>Tous</button>
          <button className={`opt ${x.sites ? "sel" : ""}`} onClick={() => setX({ ...x, sites: x.sites ?? [] })}>Certains</button>
        </div>
        {x.sites && <div className="g-jours">{sites.map((s) => {
          const on = x.sites!.includes(s.id);
          return <button key={s.id} type="button" className={`g-jour ${on ? "sel" : ""}`} onClick={() => setX({ ...x, sites: on ? x.sites!.filter((i) => i !== s.id) : [...x.sites!, s.id] })}>{s.nom}</button>;
        })}</div>}
      </div>
      {x.id && <label className="g-case"><input type="checkbox" checked={x.actif} onChange={(v) => setX({ ...x, actif: v.target.checked })} /> Actif (décoché : n'est plus demandé)</label>}
      <div className="opts">
        <button className="opt" onClick={onAnnuler}>Annuler</button>
        <button className="s3-verifier" disabled={!!manque || enCours} onClick={() => onEnregistrer({ ...x, zone: x.zone.trim(), element: x.element.trim() })}>{manque ?? "Enregistrer"}</button>
      </div>
    </section>
  );
}

function Produits({ api }: { api: Api }) {
  const [l, setL] = useState<ProduitEntretien[] | null>(null);
  const [nouveau, setNouveau] = useState(false);
  const { enCours, faire, msg } = useAction();
  const doc = useDocument(api);
  const charger = () => api.produitsEntretien().then(setL);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [api]);
  const enregistrer = (p: ProduitEntretien) => faire(async () => { await api.siegeEnregistrer("produits_entretien", { ...p }); await charger(); });
  const deposer = (p: ProduitEntretien, champ: "ft" | "fds", f: File) => faire(async () => {
    if (f.type && f.type !== "application/pdf") throw new Error("La fiche doit être un PDF");
    await api.siegeEnregistrer("produits_entretien", { id: p.id, [champ]: await api.siegeDeposerDocument(f) });
    await charger();
  }, `${champ.toUpperCase()} déposée : les tablettes la gardent dès leur prochaine connexion`);
  return (
    <section className="s3-bloc">
      <p className="hint">Déposez la fiche technique (FT) et la fiche de données de sécurité (FDS) de chaque produit, en PDF. Les tablettes les gardent pour les consulter même sans réseau.</p>
      {msg && <p className={`pill ${msg.ok ? "ok" : "bad"}`}>{msg.t}</p>}
      {nouveau ? <FormProduit p={{ nom: "", usage: null, dilution: null, temps_contact: null, ft: null, fds: null, actif: true }} enCours={enCours}
          onAnnuler={() => setNouveau(false)} onEnregistrer={(p) => { enregistrer(p); setNouveau(false); }} />
        : <button className="s3-verifier" onClick={() => setNouveau(true)}>+ Ajouter un produit</button>}
      {(l ?? []).map((p) => (
        <div key={p.id} className={`pn-prod ${p.actif ? "" : "inactif"}`}>
          <FormProduit p={p} enCours={enCours} onEnregistrer={enregistrer} />
          <div className="pn-docs">
            {(["fds", "ft"] as const).map((c) => (
              <span key={c} className="pn-doc">
                <b>{c.toUpperCase()}</b>
                {p[c] ? <button className="lien" onClick={() => doc.ouvrir(p[c]!, "application/pdf")}>voir</button> : <span className="pill bad">manquante</span>}
                <label className="lien">{p[c] ? "remplacer" : "déposer"}<input type="file" accept="application/pdf" hidden aria-label={`${c.toUpperCase()} de ${p.nom}`}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) deposer(p, c, f); e.target.value = ""; }} /></label>
              </span>
            ))}
          </div>
        </div>
      ))}
      <doc.Visionneuse />
    </section>
  );
}

function FormProduit({ p, enCours, onEnregistrer, onAnnuler }: { p: ProduitEntretien; enCours: boolean; onEnregistrer: (p: ProduitEntretien) => void; onAnnuler?: () => void }) {
  const [x, setX] = useState(p);
  useEffect(() => setX(p), [p]);
  const change = JSON.stringify(x) !== JSON.stringify(p) || !p.id;
  return (
    <div className="pn-form-prod">
      <input className="champ" value={x.nom} onChange={(v) => setX({ ...x, nom: v.target.value })} placeholder="Nom du produit" aria-label="Nom du produit" />
      <input className="champ" value={x.usage ?? ""} onChange={(v) => setX({ ...x, usage: v.target.value || null })} placeholder="Usage" aria-label="Usage" />
      <input className="champ" value={x.dilution ?? ""} onChange={(v) => setX({ ...x, dilution: v.target.value || null })} placeholder="Dilution" aria-label="Dilution" />
      <input className="champ g-court" value={x.temps_contact ?? ""} onChange={(v) => setX({ ...x, temps_contact: v.target.value || null })} placeholder="Temps de contact" aria-label="Temps de contact" />
      {p.id && <label className="g-case"><input type="checkbox" checked={x.actif} onChange={(v) => setX({ ...x, actif: v.target.checked })} /> actif</label>}
      {onAnnuler && <button className="opt" onClick={onAnnuler}>Annuler</button>}
      {change && <button className="opt sel" disabled={x.nom.trim().length < 2 || enCours} onClick={() => onEnregistrer({ ...x, nom: x.nom.trim() })}>Enregistrer</button>}
    </div>
  );
}
