import { useState } from "react";
import type { ClasseurSite, DocumentArchive, DocumentPms, DocumentSaisie, RubriqueDocument, TypeDocument } from "../types";
import { nouvelId } from "../contexte";
import { ETAT_CONTROLE } from "../logique";
import { ChampPhoto } from "../ui/Photo";

/** Classeur des documents du PMS : liste par rubrique, documents attendus, dépôt et remplacement (tablette et siège). */
export const RUBRIQUES: Record<RubriqueDocument, string> = {
  haccp: "Plan HACCP et procédures", formation: "Formation du personnel", administratif: "Administratif",
  contrats: "Contrats et prestataires", nuisibles: "Nuisibles (3D)", autre: "Autres documents",
};
const auj = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const date = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

export function Attendus({ c }: { c: ClasseurSite }) {
  const manquants = c.attendus.filter((a) => !a.present);
  return (
    <section className={`card cl-attendus ${manquants.length ? "bad" : "ok"}`}>
      <b>{manquants.length ? `${manquants.length} document${manquants.length > 1 ? "s" : ""} attendu${manquants.length > 1 ? "s" : ""} manquant${manquants.length > 1 ? "s" : ""} ou expiré${manquants.length > 1 ? "s" : ""}` : "Tous les documents attendus sont dans le classeur"}</b>
      {manquants.map((a) => <span key={a.cle} className="cl-manque">✗ {a.libelle}<span className="hint"> · {a.niveau === "groupe" ? "fourni par le siège" : "à déposer par le restaurant"}</span></span>)}
    </section>
  );
}

export function ListeClasseur({ docs, ouvrir, peutModifier, onRemplacer, onRetirer }: {
  docs: DocumentPms[]; ouvrir: (chemin: string) => void; peutModifier: (d: DocumentPms) => boolean;
  onRemplacer: (d: DocumentPms) => void; onRetirer: (d: DocumentPms) => void;
}) {
  const [aRetirer, setARetirer] = useState<string | null>(null);
  const rubriques = (Object.keys(RUBRIQUES) as RubriqueDocument[]).filter((r) => docs.some((d) => d.rubrique === r));
  if (!docs.length) return <p className="hint">Aucun document dans le classeur.</p>;
  return (<>{rubriques.map((r) => (
    <div key={r} className="cl-rubrique">
      <h3>{RUBRIQUES[r]}</h3>
      {docs.filter((d) => d.rubrique === r).map((d) => (
        <section key={d.id} className={`card cl-doc ${d.etat}`}>
          <div className="pa-tete">
            <button className="cl-titre" onClick={() => ouvrir(d.fichier)}><b>{d.titre}</b></button>
            <span>{d.groupe && <span className="pill none">groupe</span>} {d.expire_le && <span className={`pill ${ETAT_CONTROLE[d.etat].classe}`}>{d.etat === "retard" ? "expiré" : d.etat === "bientot" ? "expire bientôt" : "valide"}</span>}</span>
          </div>
          <p className="hint">{d.type}{d.personne && ` · ${d.personne}`}{d.expire_le && ` · jusqu'au ${date(d.expire_le)}`} · déposé le {date(d.at)}{d.par && ` par ${d.par}`}</p>
          <div className="opts">
            <button className="opt" onClick={() => ouvrir(d.fichier)}>Ouvrir</button>
            {peutModifier(d) && <button className="opt" onClick={() => onRemplacer(d)}>Remplacer</button>}
            {peutModifier(d) && (aRetirer === d.id
              ? <><button className="opt sel bad" onClick={() => { setARetirer(null); onRetirer(d); }}>Confirmer le retrait</button><button className="lien" onClick={() => setARetirer(null)}>annuler</button></>
              : <button className="lien" onClick={() => setARetirer(d.id)}>Retirer</button>)}
          </div>
        </section>
      ))}
    </div>
  ))}</>);
}

export function ListeArchives({ l, ouvrir }: { l: DocumentArchive[]; ouvrir: (c: string) => void }) {
  if (!l.length) return <p className="hint">Aucune archive.</p>;
  return (<div className="table-scroll"><table className="tbl"><tbody>{l.map((d) => (
    <tr key={d.id}><td><button className="lien" onClick={() => ouvrir(d.fichier)}>{d.titre}</button><br /><span className="hint">{d.type}{d.personne && ` · ${d.personne}`}</span></td>
      <td className="hint">déposé le {date(d.at)}<br />archivé le {date(d.archive_at)}</td></tr>
  ))}</tbody></table></div>);
}

/** Déposer un document (ou remplacer celui passé en `remplace`). Tablette : photo ou PDF ; siège : PDF ou image. */
export function FormDocument({ types, remplace, photo, demo = false, niveau, onAnnuler, onValider }: {
  types: TypeDocument[]; remplace?: DocumentPms | null; photo: boolean; demo?: boolean; niveau: "groupe" | "site";
  onAnnuler: () => void; onValider: (d: DocumentSaisie, fichier: Blob) => Promise<void>;
}) {
  const proposes = types.filter((t) => t.niveau === niveau || t.cle === "autre" || t.cle === remplace?.type_cle);
  const [cle, setCle] = useState(remplace?.type_cle ?? "");
  const t = types.find((x) => x.cle === cle);
  const [titre, setTitre] = useState(remplace?.titre ?? "");
  const [personne, setPersonne] = useState(remplace?.personne ?? "");
  const [expire, setExpire] = useState("");
  const [fichier, setFichier] = useState<Blob | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [idSaisie] = useState(() => nouvelId());   // même identifiant si on réessaie : pas de doublon
  const [erreur, setErreur] = useState<string | null>(null);
  const manque = !t ? "Choisissez le type de document" : titre.trim().length < 2 ? "Donnez un titre"
    : t.cle === "formation_hygiene" && personne.trim().length < 2 ? "Qui a suivi la formation ?"
    : t.expire && !expire ? "Date de fin de validité" : t.expire && expire < auj() ? "Ce document est déjà expiré" : !fichier ? "Joignez le document" : null;
  return (
    <section className="card sm-form vi-form" aria-label="Document">
      <h2 className="liv-titre">{remplace ? `Remplacer : ${remplace.titre}` : niveau === "groupe" ? "Nouveau document du groupe" : "Nouveau document"}</h2>
      {remplace && <p className="hint">L'ancienne version est archivée et reste consultable.</p>}
      <label className="champ-bloc">Type de document
        <select className="champ" value={cle} onChange={(e) => { setCle(e.target.value); const x = types.find((y) => y.cle === e.target.value); if (x && !titre) setTitre(x.cle === "autre" ? "" : x.libelle); }} aria-label="Type de document">
          <option value="">—</option>{proposes.map((x) => <option key={x.cle} value={x.cle}>{x.libelle}</option>)}
        </select></label>
      <label className="champ-bloc">Titre<input className="champ" value={titre} onChange={(e) => setTitre(e.target.value)} aria-label="Titre du document" /></label>
      {t?.cle === "formation_hygiene" && <label className="champ-bloc">Personne formée<input className="champ" value={personne} onChange={(e) => setPersonne(e.target.value)} aria-label="Personne formée" /></label>}
      {t?.expire && <label className="champ-bloc">Valable jusqu'au<input className="champ" type="date" min={auj()} value={expire} onChange={(e) => setExpire(e.target.value)} aria-label="Fin de validité" /></label>}
      <div className="champ-bloc">Document
        {photo && <ChampPhoto texte="Photographier le document" photo={fichier && fichier.type !== "application/pdf" ? fichier : null} onPhoto={setFichier} demo={demo} />}
        <input className="champ" type="file" accept="application/pdf,image/*" aria-label="Fichier du document" onChange={(e) => setFichier(e.target.files?.[0] ?? null)} />
        {fichier && <span className="hint">{fichier.type === "application/pdf" ? "PDF joint" : "Image jointe"}</span>}
      </div>
      {erreur && <p className="pill bad">{erreur}</p>}
      <div className="opts">
        <button className="opt" onClick={onAnnuler}>Annuler</button>
        <button className="bigbtn" disabled={!!manque || envoi} onClick={async () => {
          setEnvoi(true); setErreur(null);
          try {
            await onValider({ id: idSaisie, type_cle: cle, titre: titre.trim(), personne: personne.trim() || undefined, expire_le: t?.expire ? expire : undefined,
              remplace: remplace?.id }, fichier!);
          } catch (e) { setErreur((e as Error).message); setEnvoi(false); }
        }}>{manque ?? "Enregistrer"}</button>
      </div>
    </section>
  );
}
