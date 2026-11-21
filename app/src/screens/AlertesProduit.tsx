import { useEffect, useState } from "react";
import type { ActionAlerte, AlerteProduit, Api } from "../types";
import type { Entree } from "../hors-ligne/stockage";
import { nouvelId, useContexte, useEnregistrer } from "../contexte";
import { cheminPhoto } from "../logique";
import { ChampPhoto } from "../ui/Photo";
import { useToast } from "../ui/outils";

export const LIBELLE_ALERTE = { retrait: "Retrait produit", prolongation: "Prolongation DDM" } as const;
const ACTIONS_RETRAIT: { cle: ActionAlerte; libelle: string; detail: string; photo: string }[] = [
  { cle: "isole", libelle: "Mis de côté", detail: "étiqueté « NE PAS UTILISER »", photo: "Photo du produit isolé et étiqueté" },
  { cle: "repris", libelle: "Repris par le fournisseur", detail: "remis au livreur", photo: "Photo du bon de reprise" },
  { cle: "detruit", libelle: "Détruit", detail: "jeté sur consigne", photo: "Photo du produit à la poubelle" },
];
const jour = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const hm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Réponses encore sur la tablette, ajoutées à celles du serveur (une réponse hors ligne compte déjà). */
export function avecEnAttente(liste: AlerteProduit[], entrees: Entree[]): AlerteProduit[] {
  return liste.map((a) => {
    const locales = entrees.flatMap(({ op, statut }) => statut === "attente" && op.type === "reponse_alerte" && op.alerte_id === a.id
      ? [{ trouve: op.trouve, lot: op.lot ?? null, quantite: op.quantite ?? null, action: op.action ?? null, at: op.at_client }] : []);
    return locales.length ? { ...a, reponses: [...a.reponses, ...locales] } : a;
  });
}

/** Ouvre le document du fournisseur : image en plein écran, PDF dans un nouvel onglet. */
export function useDocument(api: Api) {
  const [image, setImage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const ouvrir = async (chemin: string, type: string | null) => {
    setErreur(null);
    try {
      const url = await api.urlPhoto(chemin);
      if (type?.startsWith("image/") || api.mode === "demo") setImage(url); else window.open(url, "_blank", "noopener");
    } catch { setErreur("Document indisponible sans réseau. Réessayez une fois connecté."); }
  };
  const Visionneuse = () => (<>
    {erreur && <p className="pill bad">{erreur}</p>}
    {image && <div className="visionneuse" onClick={() => setImage(null)} role="dialog" aria-label="Document"><img src={image} alt="Document du fournisseur" /><button className="opt">Fermer</button></div>}
  </>);
  return { ouvrir, Visionneuse };
}

/**
 * Alertes produit envoyées par le siège : retrait demandé par le fournisseur, prolongation de DDM.
 * Le restaurant répond « aucun lot » ou identifie chaque lot trouvé, avec photos.
 */
export function AlertesProduit({ onFini, enAttente = [] }: { onFini: () => void; enAttente?: Entree[] }) {
  const { api } = useContexte();
  const [liste, setListe] = useState<AlerteProduit[] | null>(null);
  const [choisie, setChoisie] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = () => api.alertesDuSite().then(setListe).catch((e) => setErreur((e as Error).message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { charger(); }, [api]);

  const l = avecEnAttente(liste ?? [], enAttente);
  const a = l.find((x) => x.id === choisie);
  if (a) return <Detail alerte={a} onRetour={() => { setChoisie(null); charger(); }} />;
  const aFaire = l.filter((x) => !x.reponses.length), faites = l.filter((x) => x.reponses.length);
  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>Alertes produit</h1>
      <p className="hint">Envoyées par le siège : retraits demandés par un fournisseur, prolongations de DDM.</p>
      {erreur && <p className="pill bad">{erreur}</p>}
      {!liste && !erreur && <p className="hint">Chargement…</p>}
      {liste && !l.length && <p className="pill ok">Aucune alerte en cours.</p>}
      {aFaire.length > 0 && <h2 className="sm-titre">À vérifier ({aFaire.length})</h2>}
      {aFaire.map((x) => <Carte key={x.id} a={x} onOuvrir={() => setChoisie(x.id)} />)}
      {faites.length > 0 && <h2 className="sm-titre">Déjà répondu</h2>}
      {faites.map((x) => <Carte key={x.id} a={x} onOuvrir={() => setChoisie(x.id)} />)}
    </div>
  );
}

function Carte({ a, onOuvrir }: { a: AlerteProduit; onOuvrir: () => void }) {
  const trouves = a.reponses.filter((r) => r.trouve).length;
  const [lib, cls] = !a.reponses.length ? [`À vérifier avant ${hm(a.echeance)}`, "bad"]
    : trouves ? [`${trouves} lot${trouves > 1 ? "s" : ""} traité${trouves > 1 ? "s" : ""}`, "ok"] : ["Aucun lot chez nous", "ok"];
  return (
    <button className={`sm-carte al-carte ${a.type} ${a.reponses.length ? "" : "a-faire"}`} onClick={onOuvrir}>
      <span className="sm-tete"><b><span className={`al-type ${a.type}`}>{LIBELLE_ALERTE[a.type]}</span> {a.produit}</b><span className={`pill ${cls}`}>{lib}</span></span>
      <span className="hint">{[a.fournisseur, a.lots && `lots ${a.lots}`].filter(Boolean).join(" · ")}</span>
    </button>
  );
}

function Detail({ alerte: a, onRetour }: { alerte: AlerteProduit; onRetour: () => void }) {
  const { api } = useContexte();
  const enregistrer = useEnregistrer();
  const toast = useToast();
  const doc = useDocument(api);
  const [saisie, setSaisie] = useState(!a.reponses.length ? null : false as boolean | null);   // null : choix à faire ; true : saisie d'un lot
  const [envoi, setEnvoi] = useState(false);

  async function aucun() {
    setEnvoi(true);
    try {
      await enregistrer({ type: "reponse_alerte", id: nouvelId(), alerte_id: a.id, trouve: false }, []);
      toast("Noté : aucun lot concerné");
      onRetour();
    } finally { setEnvoi(false); }
  }

  return (
    <div className="screen">
      <button className="back" onClick={onRetour}>← Retour</button>
      <h1><span className={`al-type ${a.type}`}>{LIBELLE_ALERTE[a.type]}</span> {a.produit}</h1>
      <section className="card al-infos">
        {a.fournisseur && <p><b>Fournisseur :</b> {a.fournisseur}</p>}
        {a.lots && <p><b>Lots concernés :</b> {a.lots}</p>}
        {a.type === "prolongation" && a.ddm_nouvelle && (
          <p className="al-ddm">DDM {a.ddm_origine ? <><s>{jour(a.ddm_origine)}</s> → </> : "prolongée au "}<b>{jour(a.ddm_nouvelle)}</b></p>
        )}
        {a.consigne && <p className="sm-consigne">Consigne du siège : {a.consigne}</p>}
        {a.document && <button className="opt" onClick={() => doc.ouvrir(a.document!, a.document_type)}>Voir le document du fournisseur</button>}
        <doc.Visionneuse />
      </section>

      {a.reponses.length > 0 && (
        <section className="card">
          <h2 className="liv-titre">Déjà noté</h2>
          {a.reponses.map((r, i) => (
            <p key={i} className="al-rep">{r.trouve ? <>Lot <b>{r.lot}</b> · {r.quantite} · {r.action && { reetiquete: "réétiqueté", isole: "mis de côté", repris: "repris par le fournisseur", detruit: "détruit" }[r.action]}</> : "Aucun lot concerné"} <span className="hint">à {hm(r.at)}</span></p>
          ))}
        </section>
      )}

      {saisie === true ? <SaisieLot alerte={a} onFini={() => { setSaisie(false); toast("Lot enregistré"); }} onAnnuler={() => setSaisie(a.reponses.length ? false : null)} />
        : saisie === null ? (
          <section className="card">
            <h2 className="liv-titre">Vérifiez la réserve, les chambres froides et les congélateurs</h2>
            <div className="opts">
              <button className="opt" disabled={envoi} onClick={aucun}>Aucun lot concerné</button>
              <button className="opt sel" onClick={() => setSaisie(true)}>J'ai trouvé un lot</button>
            </div>
          </section>
        ) : (
          <div className="opts">
            <button className="opt" onClick={() => setSaisie(true)}>+ Un autre lot</button>
            <button className="bigbtn" onClick={onRetour}>C'est tout</button>
          </div>
        )}
    </div>
  );
}

function SaisieLot({ alerte: a, onFini, onAnnuler }: { alerte: AlerteProduit; onFini: () => void; onAnnuler: () => void }) {
  const { api, site } = useContexte();
  const enregistrer = useEnregistrer();
  const [lot, setLot] = useState("");
  const [quantite, setQuantite] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [action, setAction] = useState<ActionAlerte | null>(a.type === "prolongation" ? "reetiquete" : null);
  const [photoAction, setPhotoAction] = useState<Blob | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const demo = api.mode === "demo";

  const manque = lot.trim().length < 1 ? "Indiquez le n° de lot" : quantite.trim().length < 1 ? "Indiquez la quantité"
    : !photo ? "Photographiez l'étiquette" : !action ? "Qu'avez-vous fait du produit ?"
    : !photoAction ? (a.type === "prolongation" ? "Photographiez la nouvelle étiquette" : "Photographiez le résultat") : null;

  async function valider() {
    if (manque) return;
    setEnvoi(true); setErreur(null);
    try {
      const c1 = cheminPhoto(site.id, nouvelId(), Date.now()), c2 = cheminPhoto(site.id, nouvelId(), Date.now());
      await enregistrer({ type: "reponse_alerte", id: nouvelId(), alerte_id: a.id, trouve: true, lot: lot.trim(), quantite: quantite.trim(),
        photo: c1, action: action!, photo_action: c2 }, [{ chemin: c1, blob: photo! }, { chemin: c2, blob: photoAction! }]);
      onFini();
    } catch (e) { setErreur((e as Error).message); setEnvoi(false); }
  }

  return (
    <section className="card sm-form">
      <label className="champ-bloc">N° de lot (sur l'étiquette)
        <input className="champ" value={lot} onChange={(e) => setLot(e.target.value)} placeholder={a.lots ? `Ex. ${a.lots.split(/[,;]/)[0].trim()}` : "Ex. L2611A"} />
      </label>
      <label className="champ-bloc">Quantité
        <input className="champ" value={quantite} onChange={(e) => setQuantite(e.target.value)} placeholder="Ex. 3 sacs de 1 kg" />
      </label>
      <ChampPhoto texte="Photo de l'étiquette avec le n° de lot" photo={photo} onPhoto={setPhoto} demo={demo} />
      {a.type === "retrait" ? (
        <div className="champ-bloc">Qu'avez-vous fait du produit ?
          <div className="liv-decisions">
            {ACTIONS_RETRAIT.map((d) => (
              <button key={d.cle} className={`liv-dec ${action === d.cle ? "sel" : ""}`} onClick={() => setAction(d.cle)}><b>{d.libelle}</b><span>{d.detail}</span></button>
            ))}
          </div>
        </div>
      ) : (
        <p className="sm-consigne">Collez une étiquette avec la nouvelle DDM{a.ddm_nouvelle ? ` (${jour(a.ddm_nouvelle)})` : ""} sur chaque conditionnement.</p>
      )}
      {action && (
        <ChampPhoto texte={a.type === "prolongation" ? "Photo du produit réétiqueté" : ACTIONS_RETRAIT.find((x) => x.cle === action)!.photo}
          photo={photoAction} onPhoto={setPhotoAction} demo={demo} />
      )}
      {erreur && <p className="pill bad">{erreur}</p>}
      <div className="opts">
        <button className="opt" onClick={onAnnuler}>Annuler</button>
        <button className="bigbtn" disabled={!!manque || envoi} onClick={valider}>{envoi ? "Enregistrement…" : manque ?? "Enregistrer ce lot"}</button>
      </div>
    </section>
  );
}
