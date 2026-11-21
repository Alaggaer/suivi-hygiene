import { useEffect, useState } from "react";
import type { ActionPlan, Api, AppareilMesure, ControleSite, ModeleControle, PmsGroupe, RubriqueControle } from "../types";
import { actionEnRetard, ETAT_CONTROLE } from "../logique";
import { useDocument } from "./AlertesProduit";

const auj = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const date = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const PERIODES = [1, 2, 3, 6, 12, 24];
const PERIODE: Record<number, string> = { 1: "chaque mois", 2: "tous les 2 mois", 3: "tous les 3 mois", 6: "tous les 6 mois", 12: "chaque année", 24: "tous les 2 ans" };
const Etat = ({ e }: { e: string }) => <span className={`pill ${ETAT_CONTROLE[e]?.classe ?? "none"}`}>{ETAT_CONTROLE[e]?.libelle ?? e}</span>;
const aFaire = (l: { etat: string }[]) => l.filter((c) => c.etat === "retard" || c.etat === "jamais" || c.etat === "hors_service").length;

/** Siège : PMS de tout le groupe (plan d'action, contrôles, sondes) et réglage des contrôles périodiques. */
export function PmsSiege({ api }: { api: Api }) {
  const [onglet, setOnglet] = useState<"groupe" | "modeles">("groupe");
  const [resto, setResto] = useState<{ id: string; nom: string } | null>(null);
  return (
    <main className="s3-main">
      <div className="s3-titre"><h1>PMS</h1><span className="hint">plan d'action, entretien technique, nuisibles, sondes</span></div>
      {resto ? <FichePms api={api} siteId={resto.id} nom={resto.nom} onRetour={() => setResto(null)} /> : <>
        <div className="s3-filtres" role="tablist">
          <button role="tab" className={`opt ${onglet === "groupe" ? "sel" : ""}`} onClick={() => setOnglet("groupe")}>Restaurants</button>
          <button role="tab" className={`opt ${onglet === "modeles" ? "sel" : ""}`} onClick={() => setOnglet("modeles")}>Contrôles à faire</button>
        </div>
        {onglet === "groupe" ? <Groupe api={api} onOuvrir={setResto} /> : <Modeles api={api} />}
      </>}
    </main>
  );
}

function Groupe({ api, onOuvrir }: { api: Api; onOuvrir: (r: { id: string; nom: string }) => void }) {
  const [l, setL] = useState<PmsGroupe[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => { api.pmsGroupe().then(setL).catch((e) => setErreur((e as Error).message)); }, [api]);
  if (erreur) return <p className="pill bad">{erreur}</p>;
  if (!l) return <p className="hint">Chargement…</p>;
  const cell = (n: number, total: number) => <span className={`pill ${n ? "bad" : "ok"}`}>{n ? `${n} à faire` : total ? "à jour" : "—"}</span>;
  return (
    <section className="s3-bloc">
      <div className="table-scroll"><table className="tbl pms-groupe"><thead><tr><th>Restaurant</th><th>Plan d'action</th><th>Entretien</th><th>Nuisibles</th><th>Sondes</th></tr></thead><tbody>
        {l.map((r) => {
          const ent = r.controles.filter((c) => c.rubrique === "entretien"), nui = r.controles.filter((c) => c.rubrique === "nuisibles");
          return (
            <tr key={r.site_id} onClick={() => onOuvrir({ id: r.site_id, nom: r.restaurant })} className="cliquable">
              <td><button className="lien"><b>{r.restaurant}</b></button></td>
              <td>{r.actions_ouvertes ? <><span className="pill warn">{r.actions_ouvertes} en cours</span>{r.actions_en_retard > 0 && <> <span className="pill bad">{r.actions_en_retard} en retard</span></>}
                {r.actions_sans_plan > 0 && <> <span className="pill none">{r.actions_sans_plan} sans action prévue</span></>}</> : <span className="pill ok">rien en cours</span>}</td>
              <td>{cell(aFaire(ent), ent.length)}</td>
              <td>{cell(aFaire(nui), nui.length)}</td>
              <td>{r.metrologie.length ? cell(aFaire(r.metrologie), r.metrologie.length) : <span className="pill bad">aucune sonde</span>}</td>
            </tr>
          );
        })}
      </tbody></table></div>
    </section>
  );
}

function FichePms({ api, siteId, nom, onRetour }: { api: Api; siteId: string; nom: string; onRetour: () => void }) {
  const [actions, setActions] = useState<ActionPlan[] | null>(null);
  const [controles, setControles] = useState<ControleSite[] | null>(null);
  const [sondes, setSondes] = useState<AppareilMesure[] | null>(null);
  const [prevoir, setPrevoir] = useState<string | null>(null);
  const [rapport, setRapport] = useState<ControleSite | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const doc = useDocument(api);
  const charger = () => Promise.all([api.planAction(siteId).then(setActions), api.etatControles(siteId).then(setControles), api.etatMetrologie(siteId).then(setSondes)])
    .catch((e) => setMsg({ ok: false, t: (e as Error).message }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [siteId]);
  const faire = async (f: () => Promise<void>, ok: string) => {
    try { await f(); setMsg({ ok: true, t: ok }); await charger(); } catch (e) { setMsg({ ok: false, t: (e as Error).message }); }
  };
  const a = auj();
  return (
    <>
      <button className="opt" onClick={onRetour}>← PMS de tous les restaurants</button>
      <h2 className="pms-nom">{nom}</h2>
      {msg && <p className={`pill ${msg.ok ? "ok" : "bad"}`}>{msg.t}</p>}
      <doc.Visionneuse />
      <section className="s3-bloc">
        <h2>Plan d'action</h2>
        {!actions ? <p className="hint">Chargement…</p> : !actions.length ? <p className="hint">Aucune action.</p> : (
          <div className="table-scroll"><table className="tbl"><tbody>{actions.map((x) => (
            <tr key={x.id} className={x.statut === "verifiee" ? "inactif" : ""}>
              <td><b>{x.titre}</b><br /><span className="hint">{x.categorie} · {x.gravite} · {date(x.cree_at)}</span>
                {x.photo && <> <button className="lien" onClick={() => doc.ouvrir(x.photo!, "image/webp")}>photo</button></>}</td>
              <td>{prevoir === x.id
                ? <PrevoirSiege a={x} onAnnuler={() => setPrevoir(null)} onValider={(act, ech) => faire(async () => { await api.siegePlanifierAction(x.id, act, ech, x.responsable_id); setPrevoir(null); }, "Action prévue")} />
                : x.action_prevue ? <span className={actionEnRetard(x, a) ? "imp-bad" : ""}>→ {x.action_prevue}{x.responsable && ` · ${x.responsable}`}{x.echeance && ` · avant le ${date(x.echeance)}`}</span>
                : x.statut === "ouverte" ? <span className="imp-bad">pas d'action prévue</span> : null}
                {x.traitee_commentaire && <><br /><span className="hint">Correction : {x.traitee_commentaire}{x.traitee_par && ` (${x.traitee_par})`}</span></>}</td>
              <td className="g-actions">
                <span className={`pill ${x.statut === "verifiee" ? "ok" : x.statut === "traitee" ? "warn" : "bad"}`}>{{ ouverte: "à corriger", traitee: "corrigée", verifiee: "close" }[x.statut]}</span>
                {x.preuve && <button className="lien" onClick={() => doc.ouvrir(x.preuve!, "image/webp")}>preuve</button>}
                {x.statut === "ouverte" && prevoir !== x.id && <button className="lien" onClick={() => setPrevoir(x.id)}>{x.action_prevue ? "modifier" : "prévoir"}</button>}
                {x.statut === "traitee" && <button className="opt sel" onClick={() => faire(() => api.siegeChangerStatut(x.id, "verifiee"), "Action close")}>Valider et clore</button>}
              </td>
            </tr>
          ))}</tbody></table></div>
        )}
      </section>
      {(["entretien", "nuisibles"] as RubriqueControle[]).map((r) => (
        <section key={r} className="s3-bloc">
          <h2>{r === "entretien" ? "Entretien technique" : "Nuisibles (3D)"}</h2>
          {rapport && rapport.rubrique === r && <RapportSiege c={rapport} onAnnuler={() => setRapport(null)}
            onValider={(d) => faire(async () => { await api.siegeEnregistrerControle(siteId, rapport.id, d.date, d.conforme, d.observation, d.prestataire, d.document); setRapport(null); },
              d.conforme ? "Contrôle enregistré" : "Contrôle enregistré : action ajoutée au plan d'action")} />}
          <div className="table-scroll"><table className="tbl"><tbody>{(controles ?? []).filter((c) => c.rubrique === r).map((c) => (
            <tr key={c.id}>
              <td><b>{c.titre}</b><br /><span className="hint">{PERIODE[c.periodicite_mois]}{c.prestataire && " · prestataire"}</span></td>
              <td>{c.dernier ? <>{date(c.dernier.date)} · {c.dernier.conforme ? "conforme" : "non conforme"}{c.dernier.par && ` · ${c.dernier.par}`}{c.dernier.prestataire && ` · ${c.dernier.prestataire}`}</> : <span className="hint">jamais</span>}
                {c.dernier?.photo && <> <button className="lien" onClick={() => doc.ouvrir(c.dernier!.photo!, "image/webp")}>photo</button></>}
                {c.dernier?.document && <> <button className="lien" onClick={() => doc.ouvrir(c.dernier!.document!, "application/pdf")}>rapport</button></>}</td>
              <td><Etat e={c.etat} />{c.prochaine && <><br /><span className="hint">avant le {date(c.prochaine)}</span></>}</td>
              <td><button className="lien" onClick={() => setRapport(c)}>Déposer un rapport</button></td>
            </tr>
          ))}</tbody></table></div>
        </section>
      ))}
      <section className="s3-bloc">
        <h2>Sondes et thermomètres</h2>
        {sondes && !sondes.length && <p className="pill bad">Aucun appareil enregistré par le restaurant.</p>}
        <div className="table-scroll"><table className="tbl"><tbody>{(sondes ?? []).map((s) => (
          <tr key={s.id}>
            <td><b>{s.nom}</b>{s.numero && <span className="hint"> n° {s.numero}</span>}</td>
            <td>{s.dernier ? <>{date(s.dernier.date)} · {{ glace: "glace fondante", ebullition: "eau bouillante", certificat: "certificat" }[s.dernier.methode]}{s.dernier.valeur !== null && ` · lu ${s.dernier.valeur} °C`}</> : <span className="hint">jamais vérifié</span>}
              {s.dernier?.photo && <> <button className="lien" onClick={() => doc.ouvrir(s.dernier!.photo!, "image/webp")}>photo</button></>}</td>
            <td><Etat e={s.etat} /></td>
          </tr>
        ))}</tbody></table></div>
      </section>
    </>
  );
}

function PrevoirSiege({ a, onAnnuler, onValider }: { a: ActionPlan; onAnnuler: () => void; onValider: (action: string, echeance: string) => void }) {
  const [act, setAct] = useState(a.action_prevue ?? "");
  const [ech, setEch] = useState(a.echeance ?? "");
  return (
    <span className="g-ajout">
      <input className="champ" value={act} onChange={(e) => setAct(e.target.value)} placeholder="Action prévue" aria-label="Action prévue" />
      <input className="champ g-court" type="date" min={auj()} value={ech} onChange={(e) => setEch(e.target.value)} aria-label="Échéance" />
      <button className="opt" onClick={onAnnuler}>Annuler</button>
      <button className="opt sel" disabled={act.trim().length < 3 || !ech || ech < auj()} onClick={() => onValider(act.trim(), ech)}>Enregistrer</button>
    </span>
  );
}

function RapportSiege({ c, onAnnuler, onValider }: {
  c: ControleSite; onAnnuler: () => void; onValider: (d: { date: string; conforme: boolean; observation: string; prestataire: string; document: File | null }) => void;
}) {
  const [d, setD] = useState(auj()); const [conforme, setConforme] = useState<boolean | null>(null);
  const [obs, setObs] = useState(""); const [presta, setPresta] = useState(""); const [document, setDocument] = useState<File | null>(null);
  const manque = conforme === null ? "Conforme ou non ?" : !conforme && obs.trim().length < 3 ? "Décrivez le problème"
    : (c.preuve !== "aucune" || !conforme) && !document ? "Joignez le rapport (PDF)" : null;
  return (
    <div className="al-form pn-form" aria-label="Rapport">
      <b>{c.titre}</b>
      <div className="sm-champs">
        <label className="champ-bloc">Date<input className="champ" type="date" max={auj()} value={d} onChange={(e) => e.target.value && setD(e.target.value)} /></label>
        <label className="champ-bloc">Entreprise<input className="champ" value={presta} onChange={(e) => setPresta(e.target.value)} /></label>
        <label className="champ-bloc sm-large">Remarques (non conforme : obligatoire)<input className="champ" value={obs} onChange={(e) => setObs(e.target.value)} /></label>
      </div>
      <div className="opts">
        <button className={`opt ${conforme === true ? "sel" : ""}`} onClick={() => setConforme(true)}>Conforme</button>
        <button className={`opt ${conforme === false ? "sel bad" : ""}`} onClick={() => setConforme(false)}>Pas conforme</button>
      </div>
      <label className="champ-bloc">Rapport (PDF)<input className="champ" type="file" accept="application/pdf" aria-label="Rapport PDF" onChange={(e) => setDocument(e.target.files?.[0] ?? null)} /></label>
      <div className="opts">
        <button className="opt" onClick={onAnnuler}>Annuler</button>
        <button className="s3-verifier" disabled={!!manque} onClick={() => onValider({ date: d, conforme: !!conforme, observation: obs.trim(), prestataire: presta.trim(), document })}>{manque ?? "Enregistrer"}</button>
      </div>
    </div>
  );
}

function Modeles({ api }: { api: Api }) {
  const [l, setL] = useState<ModeleControle[] | null>(null);
  const [edite, setEdite] = useState<ModeleControle | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const charger = () => api.modelesControles().then(setL);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [api]);
  const enregistrer = async (m: ModeleControle) => {
    try { await api.siegeEnregistrer("controles_modeles", { ...m }); setEdite(null); setMsg({ ok: true, t: "Enregistré" }); await charger(); }
    catch (e) { setMsg({ ok: false, t: (e as Error).message }); }
  };
  return (
    <section className="s3-bloc">
      <p className="hint">Les contrôles demandés à tous les restaurants (ou à certains). La périodicité décide quand un contrôle passe « en retard ».</p>
      {msg && <p className={`pill ${msg.ok ? "ok" : "bad"}`}>{msg.t}</p>}
      {edite ? <FormModele m={edite} onAnnuler={() => setEdite(null)} onValider={enregistrer} />
        : <button className="s3-verifier" onClick={() => setEdite({ rubrique: "entretien", titre: "", methode: null, periodicite_mois: 1, preuve: "aucune", prestataire: false, sites: null, ordre: 99, actif: true })}>+ Ajouter un contrôle</button>}
      {(["entretien", "nuisibles"] as RubriqueControle[]).map((r) => (
        <div key={r} className="pn-bloc-zone">
          <h3>{r === "entretien" ? "Entretien technique" : "Nuisibles (3D)"}</h3>
          <div className="table-scroll"><table className="tbl"><tbody>{(l ?? []).filter((m) => m.rubrique === r).map((m) => (
            <tr key={m.id} className={m.actif ? "" : "inactif"}>
              <td><b>{m.titre}</b>{m.methode && <><br /><span className="hint">{m.methode}</span></>}</td>
              <td>{PERIODE[m.periodicite_mois]}</td>
              <td>{m.preuve !== "aucune" && <span className="pill warn">{m.preuve === "photo" ? "photo" : "rapport"}</span>} {m.prestataire && <span className="pill none">prestataire</span>}</td>
              <td><button className="lien" onClick={() => setEdite(m)}>Modifier</button></td>
            </tr>
          ))}</tbody></table></div>
        </div>
      ))}
    </section>
  );
}

function FormModele({ m, onAnnuler, onValider }: { m: ModeleControle; onAnnuler: () => void; onValider: (m: ModeleControle) => void }) {
  const [x, setX] = useState(m);
  return (
    <section className="al-form pn-form" aria-label="Contrôle">
      <div className="opts">
        {(["entretien", "nuisibles"] as const).map((r) => <button key={r} className={`opt ${x.rubrique === r ? "sel" : ""}`} onClick={() => setX({ ...x, rubrique: r })}>{r === "entretien" ? "Entretien technique" : "Nuisibles"}</button>)}
      </div>
      <label className="champ-bloc">Contrôle<input className="champ" value={x.titre} onChange={(e) => setX({ ...x, titre: e.target.value })} placeholder="Ex. Nettoyage des condenseurs" /></label>
      <label className="champ-bloc">Comment faire (facultatif)<input className="champ" value={x.methode ?? ""} onChange={(e) => setX({ ...x, methode: e.target.value || null })} /></label>
      <div className="champ-bloc">Périodicité<div className="g-jours">{PERIODES.map((p) => <button key={p} type="button" className={`g-jour ${x.periodicite_mois === p ? "sel" : ""}`} onClick={() => setX({ ...x, periodicite_mois: p })}>{PERIODE[p]}</button>)}</div></div>
      <div className="champ-bloc">Preuve demandée<div className="opts">
        {([["aucune", "Aucune"], ["photo", "Photo"], ["document", "Rapport ou certificat"]] as const).map(([k, l]) => <button key={k} className={`opt ${x.preuve === k ? "sel" : ""}`} onClick={() => setX({ ...x, preuve: k })}>{l}</button>)}
      </div></div>
      <label className="g-case"><input type="checkbox" checked={x.prestataire} onChange={(e) => setX({ ...x, prestataire: e.target.checked })} /> Fait par un prestataire</label>
      {x.id && <label className="g-case"><input type="checkbox" checked={x.actif} onChange={(e) => setX({ ...x, actif: e.target.checked })} /> Actif</label>}
      <div className="opts">
        <button className="opt" onClick={onAnnuler}>Annuler</button>
        <button className="s3-verifier" disabled={x.titre.trim().length < 3} onClick={() => onValider({ ...x, titre: x.titre.trim() })}>{x.titre.trim().length < 3 ? "Nom du contrôle" : "Enregistrer"}</button>
      </div>
    </section>
  );
}
