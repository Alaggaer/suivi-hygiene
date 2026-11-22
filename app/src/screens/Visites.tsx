import { useState } from "react";
import type { AnalyseSaisie, EtatVisites, Gravite, NiveauVisite, ResultatAnalyse, TypeVisite, Visite, VisiteSaisie } from "../types";
import { nouvelId } from "../contexte";
import { ETAT_CONTROLE } from "../logique";
import { ChampPhoto } from "../ui/Photo";

/** Visites (Eurofins, services officiels, audits internes) et analyses bactériologiques : listes et formulaires communs tablette / siège. */
export const LIBELLE_VISITE: Record<TypeVisite, string> = { eurofins: "Eurofins", officielle: "Visite officielle (DDPP)", interne: "Audit interne", autre: "Autre visite" };
export const LIBELLE_NIVEAU: Record<NiveauVisite, string> = {
  tres_satisfaisant: "Très satisfaisant", satisfaisant: "Satisfaisant", a_ameliorer: "À améliorer", a_corriger: "À corriger de manière urgente",
};
const CLASSE_NIVEAU: Record<NiveauVisite, string> = { tres_satisfaisant: "ok", satisfaisant: "ok", a_ameliorer: "warn", a_corriger: "bad" };
export const LIBELLE_RESULTAT: Record<ResultatAnalyse, string> = { satisfaisant: "Satisfaisant", acceptable: "Acceptable", non_satisfaisant: "Non satisfaisant" };
const CLASSE_RESULTAT: Record<ResultatAnalyse, string> = { satisfaisant: "ok", acceptable: "warn", non_satisfaisant: "bad" };
const CATEGORIES = { surface: "Surface", produit: "Produit", eau: "Eau", autre: "Autre" } as const;
const auj = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const date = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

export function EtatEurofins({ e }: { e: Omit<EtatVisites, "visites"> }) {
  const c = ETAT_CONTROLE[e.etat_eurofins];
  return (
    <section className={`card vi-eurofins ${c.classe}`}>
      <b>Visite Eurofins tous les {e.eurofins_mois} mois</b>
      <span className={`pill ${c.classe}`}>{e.etat_eurofins === "jamais" ? "Aucune visite enregistrée" : c.libelle}</span>
      <span className="hint">{e.derniere_eurofins ? `Dernière le ${date(e.derniere_eurofins)} · prochaine avant le ${date(e.prochaine_eurofins!)}` : "Enregistrez la dernière visite pour démarrer le suivi."}</span>
    </section>
  );
}

export function ListeVisites({ visites, ouvrir, onAnalyses }: { visites: Visite[]; ouvrir: (chemin: string) => void; onAnalyses: (v: Visite) => void }) {
  if (!visites.length) return <p className="hint">Aucune visite enregistrée sur les 24 derniers mois.</p>;
  return (
    <>{visites.map((v) => (
      <section key={v.id} className="card pa-carte vi-carte">
        <div className="pa-tete">
          <b>{LIBELLE_VISITE[v.type]} · {date(v.date_visite)}</b>
          <span>{v.note !== null && <span className="pill none">{v.note} %</span>} {v.niveau && <span className={`pill ${CLASSE_NIVEAU[v.niveau]}`}>{LIBELLE_NIVEAU[v.niveau]}</span>}</span>
        </div>
        <p className="hint">{[v.organisme, v.intervenant, v.par && `saisie par ${v.par}`].filter(Boolean).join(" · ")}
          {v.rapport && <> · <button className="lien" onClick={() => ouvrir(v.rapport!)}>rapport</button></>}</p>
        {v.commentaire && <p className="pn-methode">{v.commentaire}</p>}
        {v.ecarts.length > 0 && <div><b className="vi-sous">Écarts ({v.ecarts.length})</b>
          {v.ecarts.map((e) => <p key={e.id} className="vi-ligne"><span className={`pill ${e.statut === "verifiee" ? "ok" : e.statut === "traitee" ? "warn" : "bad"}`}>{{ ouverte: "à corriger", traitee: "corrigé", verifiee: "clos" }[e.statut]}</span> {e.titre}</p>)}
        </div>}
        <div><b className="vi-sous">Analyses ({v.analyses.length})</b>
          {v.analyses.map((a) => <p key={a.id} className="vi-ligne"><span className={`pill ${CLASSE_RESULTAT[a.resultat]}`}>{LIBELLE_RESULTAT[a.resultat]}</span> {CATEGORIES[a.categorie]} · {a.objet}{a.detail && <span className="hint"> · {a.detail}</span>}</p>)}
          <button className="lien" onClick={() => onAnalyses(v)}>+ Ajouter des résultats d'analyses</button>
        </div>
      </section>
    ))}</>
  );
}

/** Pièce jointe : photo du rapport (tablette) ou fichier PDF / image. */
function PieceJointe({ piece, setPiece, photo, demo }: { piece: Blob | null; setPiece: (b: Blob | null) => void; photo: boolean; demo: boolean }) {
  return (
    <div className="champ-bloc">Rapport (facultatif)
      {photo && <ChampPhoto texte="Photographier le rapport" photo={piece && piece.type !== "application/pdf" ? piece : null} onPhoto={setPiece} demo={demo} />}
      <input className="champ" type="file" accept="application/pdf,image/*" aria-label="Rapport (fichier)" onChange={(e) => setPiece(e.target.files?.[0] ?? null)} />
      {piece && <span className="hint">{piece.type === "application/pdf" ? "PDF joint" : "Image jointe"}</span>}
    </div>
  );
}

function LignesAnalyses({ l, setL }: { l: AnalyseSaisie[]; setL: (l: AnalyseSaisie[]) => void }) {
  const maj = (i: number, p: Partial<AnalyseSaisie>) => setL(l.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <div className="champ-bloc">Analyses bactériologiques
      {l.map((a, i) => (
        <div key={a.id} className="vi-analyse">
          <select className="champ" value={a.categorie} onChange={(e) => maj(i, { categorie: e.target.value as AnalyseSaisie["categorie"] })} aria-label="Type d'analyse">
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="champ" value={a.objet} onChange={(e) => maj(i, { objet: e.target.value })} placeholder="Ex. coleslaw, plan de travail" aria-label="Objet analysé" />
          <div className="opts">{(Object.keys(LIBELLE_RESULTAT) as ResultatAnalyse[]).map((r) => (
            <button key={r} type="button" className={`opt ${a.resultat === r ? `sel ${r === "non_satisfaisant" ? "bad" : ""}` : ""}`} onClick={() => maj(i, { resultat: r })}>{LIBELLE_RESULTAT[r]}</button>))}</div>
          <input className="champ" value={a.detail ?? ""} onChange={(e) => maj(i, { detail: e.target.value })} placeholder="Germe, valeur (facultatif)" aria-label="Détail" />
          <button type="button" className="lien" onClick={() => setL(l.filter((_, k) => k !== i))}>retirer</button>
        </div>
      ))}
      <button type="button" className="opt" onClick={() => setL([...l, { id: nouvelId(), categorie: "surface", objet: "", resultat: "satisfaisant" }])}>+ Ajouter une analyse</button>
    </div>
  );
}

const analysesValides = (l: AnalyseSaisie[]) => l.every((a) => a.objet.trim().length >= 2);
const propre = (l: AnalyseSaisie[]) => l.map((a) => ({ ...a, objet: a.objet.trim(), detail: a.detail?.trim() || undefined }));

export function FormVisite({ photo, demo = false, onAnnuler, onValider }: { photo: boolean; demo?: boolean; onAnnuler: () => void; onValider: (v: VisiteSaisie, piece: Blob | null) => Promise<void> }) {
  const [type, setType] = useState<TypeVisite>("eurofins");
  const [d, setD] = useState(auj());
  const [organisme, setOrganisme] = useState("Eurofins");
  const [intervenant, setIntervenant] = useState("");
  const [note, setNote] = useState("");
  const [niveau, setNiveau] = useState<NiveauVisite | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [ecarts, setEcarts] = useState<{ texte: string; gravite: Gravite }[]>([]);
  const [analyses, setAnalyses] = useState<AnalyseSaisie[]>([]);
  const [piece, setPiece] = useState<Blob | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const n = note.trim() === "" ? undefined : Number(note.replace(",", "."));
  const manque = n !== undefined && (!Number.isFinite(n) || n < 0 || n > 100) ? "Note entre 0 et 100" : !analysesValides(analyses) ? "Précisez l'objet de chaque analyse"
    : ecarts.some((e) => e.texte.trim().length < 3) ? "Décrivez chaque écart (ou retirez-le)" : null;
  const choisirType = (t: TypeVisite) => { setType(t); setOrganisme(t === "eurofins" ? "Eurofins" : t === "officielle" ? "DDPP" : ""); };

  return (
    <section className="card sm-form vi-form" aria-label="Nouvelle visite">
      <h2 className="liv-titre">Nouvelle visite</h2>
      <div className="opts">{(Object.keys(LIBELLE_VISITE) as TypeVisite[]).map((t) => <button key={t} className={`opt ${type === t ? "sel" : ""}`} onClick={() => choisirType(t)}>{LIBELLE_VISITE[t]}</button>)}</div>
      <div className="sm-champs">
        <label className="champ-bloc">Date<input className="champ" type="date" max={auj()} value={d} onChange={(e) => e.target.value && setD(e.target.value)} /></label>
        <label className="champ-bloc">Organisme<input className="champ" value={organisme} onChange={(e) => setOrganisme(e.target.value)} /></label>
        <label className="champ-bloc">Intervenant (facultatif)<input className="champ" value={intervenant} onChange={(e) => setIntervenant(e.target.value)} /></label>
        <label className="champ-bloc">Note en % (facultatif)<input className="champ g-court" inputMode="decimal" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. 84" /></label>
      </div>
      <div className="champ-bloc">Résultat{type === "officielle" && " (niveau Alim'confiance)"}
        <div className="opts">{(Object.keys(LIBELLE_NIVEAU) as NiveauVisite[]).map((x) => <button key={x} className={`opt ${niveau === x ? `sel ${x === "a_corriger" ? "bad" : ""}` : ""}`} onClick={() => setNiveau(niveau === x ? null : x)}>{LIBELLE_NIVEAU[x]}</button>)}</div>
      </div>
      <label className="champ-bloc">Commentaire (facultatif)<input className="champ" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} /></label>
      <div className="champ-bloc">Écarts relevés : chacun devient une action du plan d'action
        {ecarts.map((e, i) => (
          <div key={i} className="vi-analyse">
            <input className="champ" value={e.texte} onChange={(x) => setEcarts(ecarts.map((y, k) => (k === i ? { ...y, texte: x.target.value } : y)))} placeholder="Ex. absence de thermomètre dans la CF négative" aria-label="Écart" />
            <div className="opts">{(["mineure", "majeure", "critique"] as Gravite[]).map((g) => <button key={g} type="button" className={`opt ${e.gravite === g ? `sel ${g === "critique" ? "bad" : ""}` : ""}`} onClick={() => setEcarts(ecarts.map((y, k) => (k === i ? { ...y, gravite: g } : y)))}>{g}</button>)}</div>
            <button type="button" className="lien" onClick={() => setEcarts(ecarts.filter((_, k) => k !== i))}>retirer</button>
          </div>
        ))}
        <button type="button" className="opt" onClick={() => setEcarts([...ecarts, { texte: "", gravite: "majeure" }])}>+ Ajouter un écart</button>
      </div>
      <LignesAnalyses l={analyses} setL={setAnalyses} />
      <p className="hint">Les résultats d'analyses arrivent souvent plus tard : vous pourrez les ajouter à la visite.</p>
      <PieceJointe piece={piece} setPiece={setPiece} photo={photo} demo={demo} />
      {erreur && <p className="pill bad">{erreur}</p>}
      <div className="opts">
        <button className="opt" onClick={onAnnuler}>Annuler</button>
        <button className="bigbtn" disabled={!!manque || envoi} onClick={async () => {
          setEnvoi(true); setErreur(null);
          try {
            await onValider({ id: nouvelId(), type, date_visite: d, organisme: organisme.trim() || undefined, intervenant: intervenant.trim() || undefined, note: n,
              niveau: niveau ?? undefined, commentaire: commentaire.trim() || undefined, ecarts: ecarts.map((e) => ({ ...e, texte: e.texte.trim() })), analyses: propre(analyses) }, piece);
          } catch (e) { setErreur((e as Error).message); setEnvoi(false); }
        }}>{manque ?? "Enregistrer la visite"}</button>
      </div>
    </section>
  );
}

export function FormAnalyses({ visite, photo, demo = false, onAnnuler, onValider }: {
  visite: Visite; photo: boolean; demo?: boolean; onAnnuler: () => void; onValider: (l: AnalyseSaisie[], piece: Blob | null) => Promise<void>;
}) {
  const [l, setL] = useState<AnalyseSaisie[]>([{ id: nouvelId(), categorie: "surface", objet: "", resultat: "satisfaisant", date_prelevement: visite.date_visite }]);
  const [piece, setPiece] = useState<Blob | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const manque = !l.length ? "Ajoutez au moins une analyse" : !analysesValides(l) ? "Précisez l'objet de chaque analyse" : null;
  return (
    <section className="card sm-form vi-form" aria-label="Résultats d'analyses">
      <h2 className="liv-titre">Résultats d'analyses · {LIBELLE_VISITE[visite.type]} du {date(visite.date_visite)}</h2>
      <LignesAnalyses l={l} setL={setL} />
      <p className="hint">Une analyse non satisfaisante crée une action dans le plan d'action.</p>
      <PieceJointe piece={piece} setPiece={setPiece} photo={photo} demo={demo} />
      {erreur && <p className="pill bad">{erreur}</p>}
      <div className="opts">
        <button className="opt" onClick={onAnnuler}>Annuler</button>
        <button className="bigbtn" disabled={!!manque || envoi} onClick={async () => {
          setEnvoi(true); setErreur(null);
          try { await onValider(propre(l).map((a) => ({ ...a, date_prelevement: a.date_prelevement ?? visite.date_visite })), piece); }
          catch (e) { setErreur((e as Error).message); setEnvoi(false); }
        }}>{manque ?? "Enregistrer les résultats"}</button>
      </div>
    </section>
  );
}
