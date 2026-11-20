import { useEffect, useState } from "react";
import type { Api, FournisseurNC, LigneSiege } from "../types";
import { scoreSite, tauxALheure } from "../logique";
import { pct } from "../ui/outils";

const PERIODES = [{ j: 1, l: "Aujourd'hui" }, { j: 7, l: "7 jours" }, { j: 30, l: "30 jours" }];

function pctTxt(t: number | null) { return t === null ? "—" : `${Math.round(t * 100)} %`; }
function niveauTaux(t: number | null) { return t === null ? "none" : t >= 0.95 ? "ok" : t >= 0.85 ? "warn" : "bad"; }

/** Tableau de bord du siège : 5 indicateurs par site, classés du site qui demande le plus d'attention au meilleur. */
export function TableauSiege({ api }: { api: Api }) {
  const [jours, setJours] = useState(7);
  const [lignes, setLignes] = useState<LigneSiege[] | null>(null);
  const [fournisseurs, setFournisseurs] = useState<FournisseurNC[]>([]);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    setLignes(null);
    Promise.all([api.tableauSiege(jours), api.fournisseursNonConformes(Math.max(jours, 30))])
      .then(([l, f]) => { setLignes(l); setFournisseurs(f); setErreur(null); })
      .catch((e) => setErreur((e as Error).message));
  }, [api, jours]);

  if (erreur) return <p className="pill bad">{erreur}</p>;
  if (!lignes) return <p className="hint">Chargement…</p>;

  const tri = lignes.slice().sort((a, b) => scoreSite(b) - scoreSite(a));
  const somme = (k: keyof LigneSiege) => lignes.reduce((n, l) => n + (Number(l[k]) || 0), 0);
  const tauxGroupe = tauxALheure({ taches_total: somme("taches_total"), taches_a_lheure: somme("taches_a_lheure") });

  return (
    <div className="siege">
      <div className="siege-tete">
        <h1>Tableau de bord du groupe</h1>
        <div className="opts" role="group" aria-label="Période">
          {PERIODES.map((p) => <button key={p.j} className={`opt ${jours === p.j ? "sel" : ""}`} onClick={() => setJours(p.j)}>{p.l}</button>)}
        </div>
      </div>

      <div className="tuiles">
        <div className="tuile"><span>Tâches faites à l'heure</span><b className={`t-${niveauTaux(tauxGroupe)}`}>{pctTxt(tauxGroupe)}</b><small>{somme("taches_non_faites")} non faites</small></div>
        <div className="tuile"><span>Anomalies ouvertes</span><b>{somme("anomalies_ouvertes")}</b><small className={somme("anomalies_critiques") ? "t-bad" : ""}>{somme("anomalies_critiques")} critique{somme("anomalies_critiques") > 1 ? "s" : ""}</small></div>
        <div className="tuile"><span>Livraisons non conformes</span><b>{somme("livraisons_nc")}</b><small>sur {somme("livraisons")} livraisons</small></div>
        <div className="tuile"><span>Huile au rouge</span><b className={somme("huile_rouges") ? "t-bad" : ""}>{somme("huile_rouges")}</b><small>sur {somme("huile_mesures")} mesures</small></div>
      </div>

      <section className="panel">
        <h2>Restaurants <small>du plus préoccupant au meilleur · touchez une ligne pour le détail</small></h2>
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th>Restaurant</th><th>Tâches à l'heure</th><th>Anomalies ouvertes</th><th>Livraisons NC</th><th>Huile</th><th>Stocks morts</th></tr></thead>
            <tbody>
              {tri.map((l) => {
                const t = tauxALheure(l);
                return (
                  <FragmentLigne key={l.site_id} ouvert={ouvert === l.site_id} onClick={() => setOuvert(ouvert === l.site_id ? null : l.site_id)}
                    cells={[
                      <><b>{l.nom}</b><br /><span className="hint">{l.ville}</span></>,
                      <><span className={`pill ${niveauTaux(t)}`}>{pctTxt(t)}</span>{l.taches_non_faites > 0 && <><br /><span className="hint">{l.taches_non_faites} non faite{l.taches_non_faites > 1 ? "s" : ""}</span></>}</>,
                      <><span className={`pill ${l.anomalies_critiques ? "bad" : l.anomalies_ouvertes > 3 ? "warn" : l.anomalies_ouvertes ? "none" : "ok"}`}>{l.anomalies_ouvertes}{l.anomalies_critiques ? ` · ${l.anomalies_critiques} critique` : ""}</span>{l.plus_ancienne_h ? <><br /><span className="hint">plus ancienne : {l.plus_ancienne_h} h</span></> : null}</>,
                      <span className={`pill ${l.livraisons_nc ? "warn" : "ok"}`}>{l.livraisons_nc} / {l.livraisons}</span>,
                      <><span className={`pill ${l.huile_rouges ? "bad" : "ok"}`}>{l.huile_rouges ? `${l.huile_rouges} au rouge` : "OK"}</span>{l.huile_max !== null && <><br /><span className="hint">max {pct(Number(l.huile_max))}</span></>}</>,
                      <span className="hint">en V1</span>,
                    ]}
                    detail={<Detail l={l} />} />
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
    </div>
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

function Detail({ l }: { l: LigneSiege }) {
  const lignes: [string, string][] = [
    ["Tâches échues sur la période", `${l.taches_total}`],
    ["Faites à l'heure", `${l.taches_a_lheure}`],
    ["Jamais faites", `${l.taches_non_faites}`],
    ["Anomalies ouvertes (dont critiques)", `${l.anomalies_ouvertes} (${l.anomalies_critiques})`],
    ["Livraisons non conformes", `${l.livraisons_nc} sur ${l.livraisons}`],
    ["Mesures d'huile (au rouge)", `${l.huile_mesures} (${l.huile_rouges})`],
  ];
  return (
    <div className="detail-grille">
      {lignes.map(([k, v]) => <div key={k}><span className="hint">{k}</span><b className="num">{v}</b></div>)}
      <p className="hint" style={{ gridColumn: "1 / -1", margin: 0 }}>Le détail des anomalies et des photos du restaurant arrive avec le branchement de la base (semaine 4).</p>
    </div>
  );
}
