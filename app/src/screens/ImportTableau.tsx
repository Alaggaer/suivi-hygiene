import { useState } from "react";
import type { Api } from "../types";
import { lireClasseur, planifier, type Action, type Classeur, type Modele, type Plan } from "../import/parametrage";
import { appliquer, chargerExistant, type Resultat } from "../import/appliquer";

const GROUPES: { t: Action["t"][]; titre: string }[] = [
  { t: ["site_creer", "site_maj"], titre: "Restaurants" }, { t: ["enceinte"], titre: "Enceintes" }, { t: ["friteuse"], titre: "Friteuses" },
  { t: ["employe"], titre: "Employés (un code sera créé pour chacun)" }, { t: ["fournisseur"], titre: "Fournisseurs" },
];

/**
 * Import du tableau de paramétrage : on dépose le fichier, l'app montre ce qu'elle va faire,
 * rien n'est enregistré avant « Appliquer ». Les codes des nouveaux employés s'affichent à la fin, une seule fois.
 */
export function ImportTableau({ api, onFini }: { api: Api; onFini: () => void }) {
  const [etape, setEtape] = useState<"fichier" | "lecture" | "apercu" | "envoi" | "fini">("fichier");
  const [modele, setModele] = useState<Modele | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [fait, setFait] = useState(0);
  const [res, setRes] = useState<Resultat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function lire(f: File) {
    setEtape("lecture"); setErreur(null);
    try {
      const { default: lireXlsx } = await import("read-excel-file/browser");
      const classeur = (await lireXlsx(f)) as unknown as Classeur;
      const m = lireClasseur(classeur);
      setModele(m); setPlan(planifier(m, await chargerExistant(api))); setEtape("apercu");
    } catch (e) {
      setErreur(`Fichier illisible : ${(e as Error).message}. Il faut le fichier Excel (.xlsx) du tableau de paramétrage.`); setEtape("fichier");
    }
  }
  async function lancer() {
    if (!plan) return;
    setEtape("envoi"); setFait(0);
    const r = await appliquer(api, plan.actions, setFait);
    setRes(r); setEtape("fini"); onFini();
  }

  if (etape === "fichier" || etape === "lecture") return (
    <section className="s3-bloc g-form">
      <h2>Importer le tableau de paramétrage</h2>
      <p className="hint">Déposez le fichier Excel rempli par les responsables de site. L'app vous montre d'abord ce qu'elle va créer ou modifier ; rien n'est enregistré avant votre accord, et rien n'est jamais supprimé. Vous pouvez réimporter le tableau plus tard : seules les nouveautés seront ajoutées.</p>
      {erreur && <p className="pill bad">{erreur}</p>}
      {etape === "lecture" ? <p className="hint">Lecture du tableau et comparaison avec l'existant…</p>
        : <input className="champ" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Fichier du tableau"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) lire(f); }} />}
    </section>
  );

  if (etape === "apercu" && plan && modele) {
    const refusees = modele.problemes.filter((p) => p.bloquant), infos = modele.problemes.filter((p) => !p.bloquant);
    return (
      <section className="s3-bloc imp">
        <h2>Ce que l'import va faire</h2>
        <p className="imp-resume"><b>{plan.actions.length}</b> changement{plan.actions.length > 1 ? "s" : ""} · {plan.inchanges} ligne{plan.inchanges > 1 ? "s" : ""} déjà à jour
          {refusees.length > 0 && <> · <b className="imp-bad">{refusees.length} ligne{refusees.length > 1 ? "s" : ""} refusée{refusees.length > 1 ? "s" : ""}</b></>}</p>
        {refusees.length > 0 && (
          <details className="imp-groupe" open>
            <summary className="imp-bad">Lignes refusées : à corriger dans le tableau puis réimporter</summary>
            <ul>{refusees.map((p, i) => <li key={i}><span className="hint">{p.onglet}{p.ligne ? `, ligne ${p.ligne}` : ""} :</span> {p.message}</li>)}</ul>
          </details>
        )}
        {GROUPES.map((g) => {
          const l = plan.actions.filter((a) => g.t.includes(a.t));
          return l.length ? (
            <details key={g.titre} className="imp-groupe" open={l.length <= 12}>
              <summary>{g.titre} · {l.length}</summary>
              <ul>{l.map((a, i) => <li key={i}>{a.libelle}</li>)}</ul>
            </details>
          ) : null;
        })}
        {infos.length > 0 && (
          <details className="imp-groupe">
            <summary>À savoir · {infos.length}</summary>
            <ul>{infos.map((p, i) => <li key={i}><span className="hint">{p.onglet}{p.ligne ? `, ligne ${p.ligne}` : ""} :</span> {p.message}</li>)}</ul>
          </details>
        )}
        {plan.nonRepris.length > 0 && (
          <details className="imp-groupe">
            <summary>Absents du tableau, laissés tels quels · {plan.nonRepris.length}</summary>
            <p className="hint">Pour les retirer, désactivez-les dans Gestion.</p>
            <ul>{plan.nonRepris.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </details>
        )}
        <div className="opts">
          <button className="opt" onClick={() => { setEtape("fichier"); setPlan(null); }}>Choisir un autre fichier</button>
          <button className="s3-verifier" disabled={!plan.actions.length} onClick={lancer}>
            {plan.actions.length ? `Appliquer les ${plan.actions.length} changements` : "Rien à changer"}</button>
        </div>
      </section>
    );
  }

  if (etape === "envoi" && plan) return (
    <section className="s3-bloc"><h2>Import en cours…</h2>
      <div className="sm-barre"><span className="ok" style={{ width: `${(fait / (plan.actions.length || 1)) * 100}%` }} /></div>
      <p className="hint">{fait} / {plan.actions.length} · ne fermez pas la page</p>
    </section>
  );

  if (etape === "fini" && res) {
    const parResto = [...new Set(res.pins.map((p) => p.restaurant))];
    return (
      <section className="s3-bloc imp">
        <h2>Import terminé</h2>
        <p className="imp-resume"><span className="pill ok">{res.faits} changement{res.faits > 1 ? "s" : ""} enregistré{res.faits > 1 ? "s" : ""}</span>
          {res.erreurs.length > 0 && <> <span className="pill bad">{res.erreurs.length} refusé{res.erreurs.length > 1 ? "s" : ""}</span></>}</p>
        {res.erreurs.length > 0 && <ul className="imp-groupe">{res.erreurs.map((e, i) => <li key={i}>{e.libelle} : <span className="imp-bad">{e.message}</span></li>)}</ul>}
        {res.pins.length > 0 && <>
          <p className="g-pin-alerte">Codes des nouveaux employés : <b>imprimez cette page maintenant</b>, les codes ne seront plus affichés. Remettez à chacun son code.</p>
          <button className="s3-verifier imp-noprint" onClick={() => window.print()}>Imprimer les codes</button>
          <div className="imp-codes">
            {parResto.map((r) => (
              <div key={r} className="imp-resto">
                <h3>{r}</h3>
                <table className="tbl"><tbody>{res.pins.filter((p) => p.restaurant === r).map((p) => (
                  <tr key={p.nom}><td>{p.nom}</td><td className="imp-code">{p.pin}</td></tr>
                ))}</tbody></table>
              </div>
            ))}
          </div>
        </>}
        <button className="opt imp-noprint" onClick={() => { setEtape("fichier"); setRes(null); }}>Importer un autre fichier</button>
      </section>
    );
  }
  return null;
}
