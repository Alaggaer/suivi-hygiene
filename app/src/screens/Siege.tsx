import { useEffect, useState } from "react";
import type { AnomalieSiege, Api, FournisseurNC, LigneSiege, Preuves } from "../types";
import { scoreSite, tauxALheure } from "../logique";
import { pct } from "../ui/outils";

const PERIODES = [{ j: 1, l: "Aujourd'hui" }, { j: 7, l: "7 jours" }, { j: 30, l: "30 jours" }];

function pctTxt(t: number | null) { return t === null ? "—" : `${Math.round(t * 100)} %`; }
function niveauTaux(t: number | null) { return t === null ? "none" : t >= 0.95 ? "ok" : t >= 0.85 ? "warn" : "bad"; }

type Onglet = "tableau" | "anomalies" | "preuves";

/** Espace siège : tableau de bord du groupe, anomalies de tous les restaurants, preuves par restaurant et par jour. */
export function TableauSiege({ api }: { api: Api }) {
  const [onglet, setOnglet] = useState<Onglet>("tableau");
  const [sites, setSites] = useState<{ id: string; nom: string }[]>([]);
  const [sitePreuves, setSitePreuves] = useState<string | null>(null);
  const [aTraiter, setATraiter] = useState<number | null>(null);
  const compter = () => api.anomaliesSiege().then((l) => setATraiter(l.filter((a) => a.statut !== "verifiee").length)).catch(() => {});
  useEffect(() => { compter(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [api]);
  return (
    <div className="siege">
      <div className="opts onglets" role="tablist">
        <button role="tab" className={`opt ${onglet === "tableau" ? "sel" : ""}`} onClick={() => setOnglet("tableau")}>Tableau de bord</button>
        <button role="tab" className={`opt ${onglet === "anomalies" ? "sel" : ""}`} onClick={() => setOnglet("anomalies")}>
          Anomalies{aTraiter ? <span className="compte">{aTraiter}</span> : null}
        </button>
        <button role="tab" className={`opt ${onglet === "preuves" ? "sel" : ""}`} onClick={() => setOnglet("preuves")}>Preuves</button>
      </div>
      {onglet === "tableau" && <Tableau api={api} onSites={setSites} onPreuves={(id) => { setSitePreuves(id); setOnglet("preuves"); }} />}
      {onglet === "anomalies" && <AnomaliesSiegeVue api={api} onChange={compter} />}
      {onglet === "preuves" && <PreuvesVue api={api} sites={sites} siteInitial={sitePreuves} />}
    </div>
  );
}

/** Tableau de bord : indicateurs par site, classés du site qui demande le plus d'attention au meilleur. */
function Tableau({ api, onSites, onPreuves }: { api: Api; onSites: (s: { id: string; nom: string }[]) => void; onPreuves: (siteId: string) => void }) {
  const [jours, setJours] = useState(7);
  const [lignes, setLignes] = useState<LigneSiege[] | null>(null);
  const [fournisseurs, setFournisseurs] = useState<FournisseurNC[]>([]);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    setLignes(null);
    Promise.all([api.tableauSiege(jours), api.fournisseursNonConformes(Math.max(jours, 30))])
      .then(([l, f]) => { setLignes(l); setFournisseurs(f); setErreur(null); onSites(l.map((x) => ({ id: x.site_id, nom: x.nom }))); })
      .catch((e) => setErreur((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, jours]);

  if (erreur) return <p className="pill bad">{erreur}</p>;
  if (!lignes) return <p className="hint">Chargement…</p>;

  const tri = lignes.slice().sort((a, b) => scoreSite(b) - scoreSite(a));
  const somme = (k: keyof LigneSiege) => lignes.reduce((n, l) => n + (Number(l[k]) || 0), 0);
  const tauxGroupe = tauxALheure({ taches_total: somme("taches_total"), taches_a_lheure: somme("taches_a_lheure") });

  return (
    <>
      <div className="siege-tete">
        <h1>Tableau de bord du groupe</h1>
        <div className="opts" role="group" aria-label="Période">
          {PERIODES.map((p) => <button key={p.j} className={`opt ${jours === p.j ? "sel" : ""}`} onClick={() => setJours(p.j)}>{p.l}</button>)}
        </div>
      </div>

      <div className="tuiles">
        <div className="tuile"><span>Tâches faites à l'heure</span><b className={`t-${niveauTaux(tauxGroupe)}`}>{pctTxt(tauxGroupe)}</b><small>{somme("taches_non_faites")} non faites</small></div>
        <div className="tuile"><span>Anomalies non traitées</span><b>{somme("anomalies_ouvertes")}</b><small className={somme("anomalies_critiques") ? "t-bad" : ""}>{somme("anomalies_critiques")} critique{somme("anomalies_critiques") > 1 ? "s" : ""} · {somme("anomalies_a_verifier")} à vérifier</small></div>
        <div className="tuile"><span>Livraisons non conformes</span><b>{somme("livraisons_nc")}</b><small>sur {somme("livraisons")} livraisons</small></div>
        <div className="tuile"><span>Huile au rouge</span><b className={somme("huile_rouges") ? "t-bad" : ""}>{somme("huile_rouges")}</b><small>sur {somme("huile_mesures")} mesures{somme("huile_trop_vieille") ? ` · ${somme("huile_trop_vieille")} trop vieille` : ""}</small></div>
      </div>

      <section className="panel">
        <h2>Restaurants <small>du plus préoccupant au meilleur · touchez une ligne pour le détail</small></h2>
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th>Restaurant</th><th>Tâches à l'heure</th><th>Anomalies</th><th>Livraisons NC</th><th>Huile</th><th>Stocks morts</th></tr></thead>
            <tbody>
              {tri.map((l) => {
                const t = tauxALheure(l);
                return (
                  <FragmentLigne key={l.site_id} ouvert={ouvert === l.site_id} onClick={() => setOuvert(ouvert === l.site_id ? null : l.site_id)}
                    cells={[
                      <><b>{l.nom}</b><br /><span className="hint">{l.ville}</span></>,
                      <><span className={`pill ${niveauTaux(t)}`}>{pctTxt(t)}</span>{l.taches_non_faites > 0 && <><br /><span className="hint">{l.taches_non_faites} non faite{l.taches_non_faites > 1 ? "s" : ""}</span></>}</>,
                      <><span className={`pill ${l.anomalies_critiques ? "bad" : l.anomalies_ouvertes > 3 ? "warn" : l.anomalies_ouvertes ? "none" : "ok"}`}>{l.anomalies_ouvertes} à traiter{l.anomalies_critiques ? ` · ${l.anomalies_critiques} critique` : ""}</span>{l.anomalies_a_verifier > 0 && <><br /><span className="hint">{l.anomalies_a_verifier} à vérifier</span></>}{l.plus_ancienne_h ? <><br /><span className="hint">plus ancienne : {l.plus_ancienne_h} h</span></> : null}</>,
                      <span className={`pill ${l.livraisons_nc ? "warn" : "ok"}`}>{l.livraisons_nc} / {l.livraisons}</span>,
                      <><span className={`pill ${l.huile_rouges || l.huile_trop_vieille ? "bad" : "ok"}`}>{l.huile_rouges ? `${l.huile_rouges} au rouge` : l.huile_trop_vieille ? "" : "OK"}{l.huile_trop_vieille ? `${l.huile_rouges ? " · " : ""}${l.huile_trop_vieille} trop vieille` : ""}</span>{l.huile_max !== null && <><br /><span className="hint">max {pct(Number(l.huile_max))}</span></>}</>,
                      <span className="hint">en V1</span>,
                    ]}
                    detail={<Detail l={l} onPreuves={() => onPreuves(l.site_id)} />} />
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Fournisseurs <small>livraisons non conformes · {Math.max(jours, 30)} derniers jours</small></h2>
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th>Fournisseur</th><th>Livraisons</th><th>Non conformes</th><th>Taux</th></tr></thead>
            <tbody>{fournisseurs.map((f) => (
              <tr key={f.fournisseur}><td><b>{f.fournisseur}</b></td><td className="num">{f.livraisons}</td><td className="num">{f.non_conformes}</td>
                <td><span className={`pill ${f.non_conformes / Math.max(1, f.livraisons) > 0.05 ? "bad" : f.non_conformes ? "warn" : "ok"}`}>{pctTxt(f.non_conformes / Math.max(1, f.livraisons))}</span></td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function FragmentLigne({ cells, detail, ouvert, onClick }: { cells: React.ReactNode[]; detail: React.ReactNode; ouvert: boolean; onClick: () => void }) {
  return (
    <>
      <tr className={`clic ${ouvert ? "ouvert" : ""}`} onClick={onClick} tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()} aria-expanded={ouvert}>
        {cells.map((c, i) => <td key={i}>{c}</td>)}
      </tr>
      {ouvert && <tr className="detail"><td colSpan={cells.length}>{detail}</td></tr>}
    </>
  );
}

function Detail({ l, onPreuves }: { l: LigneSiege; onPreuves: () => void }) {
  const lignes: [string, string][] = [
    ["Tâches échues sur la période", `${l.taches_total}`],
    ["Faites à l'heure", `${l.taches_a_lheure}`],
    ["Jamais faites", `${l.taches_non_faites}`],
    ["Anomalies à traiter / à vérifier", `${l.anomalies_ouvertes} / ${l.anomalies_a_verifier}`],
    ["Dont critiques non closes", `${l.anomalies_critiques}`],
    ["Livraisons non conformes", `${l.livraisons_nc} sur ${l.livraisons}`],
    ["Mesures d'huile (au rouge)", `${l.huile_mesures} (${l.huile_rouges})`],
    ["Friteuses à l'huile trop vieille", `${l.huile_trop_vieille}`],
  ];
  return (
    <div className="detail-grille">
      {lignes.map(([k, v]) => <div key={k}><span className="hint">{k}</span><b className="num">{v}</b></div>)}
      <button className="opt" style={{ gridColumn: "1 / -1", justifySelf: "start" }} onClick={onPreuves}>Voir les preuves du jour de ce restaurant →</button>
    </div>
  );
}

const G = { critique: "bad", majeure: "warn", mineure: "none" } as const;
const quand = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const deg = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR")} °C`);

/** Anomalies de tout le groupe : le siège peut les marquer traitées (avec commentaire) et les vérifier. */
function AnomaliesSiegeVue({ api, onChange }: { api: Api; onChange: () => void }) {
  const [liste, setListe] = useState<AnomalieSiege[] | null>(null);
  const [filtre, setFiltre] = useState<"ouverte" | "traitee" | "verifiee">("ouverte");
  const [commentaires, setCommentaires] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = () => api.anomaliesSiege().then((l) => { setListe(l); setErreur(null); }).catch((e) => setErreur((e as Error).message));
  useEffect(() => { charger(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [api]);

  async function agir(a: AnomalieSiege, statut: "traitee" | "verifiee") {
    setEnCours(a.id); setErreur(null);
    try { await api.siegeChangerStatut(a.id, statut, commentaires[a.id]?.trim() || undefined); await charger(); onChange(); }
    catch (e) { setErreur((e as Error).message); }
    finally { setEnCours(null); }
  }

  if (!liste) return erreur ? <p className="pill bad">{erreur}</p> : <p className="hint">Chargement…</p>;
  const n = (s: string) => liste.filter((a) => a.statut === s).length;
  const vues = liste.filter((a) => a.statut === filtre);
  return (
    <section className="panel">
      <h2>Anomalies du groupe <small>les critiques d'abord, puis les plus anciennes</small></h2>
      <div className="opts">
        <button className={`opt ${filtre === "ouverte" ? "sel" : ""}`} onClick={() => setFiltre("ouverte")}>À traiter ({n("ouverte")})</button>
        <button className={`opt ${filtre === "traitee" ? "sel" : ""}`} onClick={() => setFiltre("traitee")}>À vérifier ({n("traitee")})</button>
        <button className={`opt ${filtre === "verifiee" ? "sel" : ""}`} onClick={() => setFiltre("verifiee")}>Vérifiées · 7 jours ({n("verifiee")})</button>
      </div>
      {erreur && <p className="pill bad">{erreur}</p>}
      {!vues.length && <p className="hint">Rien ici.</p>}
      <div className="cartes">
        {vues.map((a) => (
          <div key={a.id} className={`carte ${a.gravite === "critique" && a.statut !== "verifiee" ? "bad" : ""}`}>
            <div className="carte-tete"><b>{a.restaurant}</b><span className={`pill ${G[a.gravite]}`}>{a.gravite}</span></div>
            <p className="carte-titre">{a.titre}</p>
            <p className="hint">{a.categorie} · signalée {quand(a.cree_at)}{a.cree_par ? ` par ${a.cree_par}` : " automatiquement"}</p>
            {a.traitee_at && <p className="hint">Traitée {quand(a.traitee_at)} par {a.traitee_par}{a.traitee_commentaire ? ` : « ${a.traitee_commentaire} »` : ""}</p>}
            {a.verifiee_at && <p className="hint">Vérifiée {quand(a.verifiee_at)} par {a.verifiee_par}</p>}
            {a.statut === "ouverte" && (
              <div className="carte-actions">
                <input className="champ" placeholder="Ce qui a été fait (facultatif)" value={commentaires[a.id] ?? ""}
                  onChange={(e) => setCommentaires({ ...commentaires, [a.id]: e.target.value })} />
                <button className="opt" disabled={enCours === a.id} onClick={() => agir(a, "traitee")}>Marquer traitée</button>
              </div>
            )}
            {a.statut === "traitee" && (
              <div className="carte-actions">
                <button className="opt sel" disabled={enCours === a.id} onClick={() => agir(a, "verifiee")}>Vérifier et clore</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Preuves d'un restaurant pour un jour : tâches, relevés, huile, livraisons (photo du BL), traçabilité produits. */
function PreuvesVue({ api, sites, siteInitial }: { api: Api; sites: { id: string; nom: string }[]; siteInitial: string | null }) {
  const aujourdHui = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
  const [liste, setListe] = useState(sites);
  const [site, setSite] = useState<string | null>(siteInitial ?? sites[0]?.id ?? null);
  const [jour, setJour] = useState(aujourdHui);
  const [p, setP] = useState<Preuves | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (liste.length) return;
    api.tableauSiege(1).then((l) => { const s = l.map((x) => ({ id: x.site_id, nom: x.nom })); setListe(s); setSite((v) => v ?? s[0]?.id ?? null); }).catch(() => {});
  }, [api, liste.length]);
  useEffect(() => {
    if (!site) return;
    setP(null); setErreur(null);
    api.preuvesJour(site, jour).then(setP).catch((e) => setErreur((e as Error).message));
  }, [api, site, jour]);
  const voir = async (chemin: string) => {
    try { setPhoto(await api.urlPhoto(chemin)); } catch (e) { setErreur((e as Error).message); }
  };

  return (
    <section className="panel preuves">
      <h2>Preuves <small>ce qu'on montre lors d'un contrôle</small></h2>
      <div className="preuves-choix">
        <select className="champ" value={site ?? ""} onChange={(e) => setSite(e.target.value)} aria-label="Restaurant">
          {liste.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
        </select>
        <input className="champ" type="date" value={jour} max={aujourdHui} onChange={(e) => e.target.value && setJour(e.target.value)} aria-label="Jour" />
      </div>
      {erreur && <p className="pill bad">{erreur}</p>}
      {!p && !erreur && <p className="hint">Chargement…</p>}
      {p && (
        <>
          <Bloc titre="Tâches du jour" vide={!p.taches.length}>
            <table className="tbl"><tbody>{p.taches.map((t, i) => (
              <tr key={i}><td><b>{t.titre}</b></td><td>avant {heure(t.echeance)}</td>
                <td>{t.faite_at
                  ? <span className={`pill ${new Date(t.faite_at) <= new Date(t.echeance) ? "ok" : "warn"}`}>faite à {heure(t.faite_at)}{t.par ? ` · ${t.par}` : ""}</span>
                  : <span className="pill bad">non faite</span>}</td></tr>
            ))}</tbody></table>
          </Bloc>
          <Bloc titre="Relevés de températures" vide={!p.releves.length}>
            <table className="tbl"><tbody>{p.releves.map((r, i) => (
              <tr key={i}><td>{heure(r.at)}</td><td><b>{r.enceinte}</b></td><td className="num">{deg(r.valeur)}</td>
                <td><span className={`pill ${r.conforme ? "ok" : "bad"}`}>{r.conforme ? "conforme" : `max ${deg(r.t_max)}`}</span>{r.action && <><br /><span className="hint">{r.action}</span></>}</td><td className="hint">{r.par}</td></tr>
            ))}</tbody></table>
          </Bloc>
          <Bloc titre="Huile" vide={!p.huiles.length}>
            <table className="tbl"><tbody>{p.huiles.map((h, i) => (
              <tr key={i}><td>{heure(h.at)}</td><td><b>{h.friteuse}</b></td>
                <td>{h.non_utilisee ? <span className="pill none">non utilisée</span> : <span className="num">{h.polaires === null ? "—" : `${h.polaires.toLocaleString("fr-FR")} %`}</span>}</td>
                <td className="hint">{[h.filtrage && "filtrée", h.changement && "huile changée"].filter(Boolean).join(" · ")}</td><td className="hint">{h.par}</td></tr>
            ))}</tbody></table>
          </Bloc>
          <Bloc titre="Livraisons" vide={!p.livraisons.length}>
            <table className="tbl"><tbody>{p.livraisons.map((l, i) => (
              <tr key={i}><td>{heure(l.at)}</td><td><b>{l.fournisseur}</b>{l.viande && <><br /><span className="hint">viande · origine {l.origine_ok ? "vérifiée" : "non vérifiée"}</span></>}</td>
                <td className="hint">camion {deg(l.t_camion)}{l.t_frais !== null ? ` · frais ${deg(l.t_frais)}` : ""}{l.t_surgele !== null ? ` · surgelé ${deg(l.t_surgele)}` : ""}</td>
                <td><span className={`pill ${l.conforme ? "ok" : "bad"}`}>{l.conforme ? "conforme" : "non conforme"}</span>{!l.conforme && <><br /><span className="hint">{(l.motifs ?? []).join(", ")} · {l.action}</span></>}
                  <br /><span className="hint">{l.range_at ? `rangée à ${heure(l.range_at)}` : "rangement non validé"}</span></td>
                <td><button className="lien" onClick={() => voir(l.photo_bl)}>Bon de livraison</button>{l.photo_nc && <><br /><button className="lien" onClick={() => voir(l.photo_nc!)}>Photo du problème</button></>}</td></tr>
            ))}</tbody></table>
          </Bloc>
          <Bloc titre="Traçabilité produits" vide={!p.produits.length}>
            <table className="tbl"><tbody>{p.produits.map((u, i) => (
              <tr key={i}><td>{heure(u.at)}</td><td><b>{u.famille}</b></td><td className="hint">service du {u.service}</td><td className="hint">{u.par}</td>
                <td><button className="lien" onClick={() => voir(u.photo)}>Étiquette</button></td></tr>
            ))}</tbody></table>
          </Bloc>
          <Bloc titre="Anomalies signalées ce jour" vide={!p.anomalies.length}>
            <table className="tbl"><tbody>{p.anomalies.map((a, i) => (
              <tr key={i}><td>{heure(a.at)}</td><td>{a.titre}</td><td><span className={`pill ${G[a.gravite]}`}>{a.gravite}</span></td>
                <td className="hint">{a.statut === "ouverte" ? "à traiter" : a.statut === "traitee" ? "traitée, à vérifier" : "vérifiée"}</td></tr>
            ))}</tbody></table>
          </Bloc>
        </>
      )}
      {photo && (
        <div className="visionneuse" onClick={() => setPhoto(null)} role="dialog" aria-label="Photo">
          <img src={photo} alt="Photo" />
          <button className="opt">Fermer</button>
        </div>
      )}
    </section>
  );
}

function Bloc({ titre, vide, children }: { titre: string; vide: boolean; children: React.ReactNode }) {
  return (
    <div className="bloc">
      <h3>{titre}</h3>
      {vide ? <p className="hint">Aucune saisie.</p> : <div className="table-scroll">{children}</div>}
    </div>
  );
}
