import { useEffect, useState } from "react";
import type { DecisionStock, StockMort } from "../types";
import type { Entree } from "../hors-ligne/stockage";
import { nouvelId, useContexte, useEnregistrer } from "../contexte";
import { cheminPhoto } from "../logique";
import { ChampPhoto } from "../ui/Photo";
import { useToast } from "../ui/outils";

const DECISIONS: { cle: DecisionStock; libelle: string; detail: string }[] = [
  { cle: "jete", libelle: "Jeté", detail: "maintenant, c'est fini" },
  { cle: "transfere", libelle: "Transféré", detail: "à un autre restaurant" },
  { cle: "a_ecouler", libelle: "À écouler", detail: "selon la consigne du siège" },
];
const jour = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/**
 * Stocks morts : produits sortis de la carte (déclarés par le siège). Le restaurant dit s'il lui en reste ;
 * si oui : quantité, DLC, photo et ce qu'il en fait. « À écouler » est redemandé après 7 jours ou à la DLC.
 */
export function StocksMorts({ onFini, enAttente = [] }: { onFini: () => void; enAttente?: Entree[] }) {
  const { api } = useContexte();
  const [liste, setListe] = useState<StockMort[] | null>(null);
  const [choisi, setChoisi] = useState<StockMort | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => { api.stocksMortsDuSite().then(setListe).catch((e) => setErreur(e.message)); }, [api, choisi]);

  if (choisi) return <Verification produit={choisi} onFini={() => setChoisi(null)} />;
  // Réponses encore sur la tablette : le produit n'est plus « à faire ».
  const envoyes = new Map<string, { reste: boolean; quantite?: string; dlc?: string; decision?: DecisionStock }>();
  for (const { op, statut } of enAttente) if (statut === "attente" && op.type === "stock_mort") envoyes.set(op.produit_id, op);
  const l = (liste ?? []).map((p): StockMort => {
    const o = envoyes.get(p.produit_id);
    if (!o) return p;
    const etat = !o.reste || o.decision === "jete" || o.decision === "transfere" ? "solde" : "a_ecouler";
    return { ...p, a_faire: false, etat, quantite: o.quantite ?? null, dlc: o.dlc ?? null };
  });
  const aFaire = l.filter((p) => p.a_faire), autres = l.filter((p) => !p.a_faire);

  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>Stocks morts</h1>
      <p className="hint">Produits sortis de la carte. Vérifiez la réserve, les chambres froides et les congélateurs.</p>
      {erreur && <p className="pill bad">{erreur}</p>}
      {!liste && !erreur && <p className="hint">Chargement…</p>}
      {liste && !l.length && <p className="pill ok">Aucun produit retiré de la carte pour le moment.</p>}
      {aFaire.length > 0 && <h2 className="sm-titre">À vérifier ({aFaire.length})</h2>}
      {aFaire.map((p) => <Carte key={p.produit_id} p={p} onOuvrir={() => setChoisi(p)} />)}
      {autres.length > 0 && <h2 className="sm-titre">Déjà vérifiés</h2>}
      {autres.map((p) => <Carte key={p.produit_id} p={p} onOuvrir={() => setChoisi(p)} />)}
    </div>
  );
}

function Carte({ p, onOuvrir }: { p: StockMort; onOuvrir: () => void }) {
  const [lib, cls] = p.a_faire
    ? [p.etat === "a_ecouler" ? "À revérifier" : "À vérifier", "bad"]
    : p.etat === "a_ecouler" ? [`À écouler · ${p.quantite ?? ""}`, "warn"] : ["Soldé", "ok"];
  return (
    <button className={`sm-carte ${p.a_faire ? "a-faire" : ""}`} onClick={onOuvrir} disabled={p.etat === "solde" && !p.a_faire}>
      <span className="sm-tete"><b>{p.nom}</b><span className={`pill ${cls}`}>{lib}</span></span>
      <span className="hint">{[p.fournisseur, `sorti de la carte le ${jour(p.sortie_le)}`, p.dlc && `DLC ${jour(p.dlc)}`].filter(Boolean).join(" · ")}</span>
      {p.consigne && <span className="sm-consigne">Consigne du siège : {p.consigne}</span>}
    </button>
  );
}

function Verification({ produit, onFini }: { produit: StockMort; onFini: () => void }) {
  const { api, site } = useContexte();
  const enregistrer = useEnregistrer();
  const toast = useToast();
  const [reste, setReste] = useState<boolean | null>(null);
  const [quantite, setQuantite] = useState(produit.quantite ?? "");
  const [dlc, setDlc] = useState(produit.dlc ?? "");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [decision, setDecision] = useState<DecisionStock | null>(null);
  const [vers, setVers] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const manque = reste === null ? "Il vous en reste ?"
    : !reste ? null
    : quantite.trim().length < 1 ? "Indiquez la quantité" : !photo ? "Photographiez le produit" : !decision ? "Que faites-vous du produit ?"
    : decision === "transfere" && vers.trim().length < 2 ? "Vers quel restaurant ?" : null;

  async function valider() {
    if (manque) return;
    setEnvoi(true); setErreur(null);
    try {
      const chemin = reste && photo ? cheminPhoto(site.id, nouvelId(), Date.now()) : undefined;
      await enregistrer({
        type: "stock_mort", id: nouvelId(), produit_id: produit.produit_id, reste: !!reste,
        quantite: reste ? quantite.trim() : undefined, dlc: reste && dlc ? dlc : undefined, photo: chemin,
        decision: reste ? decision! : undefined, transfert_vers: decision === "transfere" ? vers.trim() : undefined,
      }, chemin && photo ? [{ chemin, blob: photo }] : []);
      toast(!reste ? "Noté : plus rien en stock" : decision === "a_ecouler" ? "Noté : à écouler, à revérifier dans 7 jours" : "Noté : stock soldé");
      onFini();
    } catch (e) { setErreur((e as Error).message); setEnvoi(false); }
  }

  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>{produit.nom}</h1>
      <p className="hint">{[produit.fournisseur, `sorti de la carte le ${jour(produit.sortie_le)}`].filter(Boolean).join(" · ")}</p>
      {produit.consigne && <p className="sm-consigne">Consigne du siège : {produit.consigne}</p>}
      <section className="card">
        <h2 className="liv-titre">Il vous en reste ?</h2>
        <div className="opts">
          <button className={`opt ${reste === false ? "sel ok" : ""}`} onClick={() => setReste(false)}>Non, plus rien</button>
          <button className={`opt ${reste === true ? "sel" : ""}`} onClick={() => setReste(true)}>Oui, il en reste</button>
        </div>
      </section>
      {reste && (
        <section className="card sm-form">
          <label className="champ-bloc">Quantité restante
            <input className="champ" value={quantite} onChange={(e) => setQuantite(e.target.value)} placeholder="Ex. 3 cartons, 2 bidons de 5 L" />
          </label>
          <label className="champ-bloc">DLC la plus proche (si indiquée)
            <input className="champ" type="date" value={dlc} onChange={(e) => setDlc(e.target.value)} />
          </label>
          <ChampPhoto texte="Photo du produit et de son étiquette" photo={photo} onPhoto={setPhoto} demo={api.mode === "demo"} />
          <div className="champ-bloc">Que faites-vous du produit ?
            <div className="liv-decisions">
              {DECISIONS.map((d) => (
                <button key={d.cle} className={`liv-dec ${decision === d.cle ? "sel" : ""}`} onClick={() => setDecision(d.cle)}><b>{d.libelle}</b><span>{d.detail}</span></button>
              ))}
            </div>
          </div>
          {decision === "transfere" && (
            <label className="champ-bloc">Vers quel restaurant ?
              <input className="champ" value={vers} onChange={(e) => setVers(e.target.value)} placeholder="Ex. BOSTON" />
            </label>
          )}
        </section>
      )}
      {erreur && <p className="pill bad">{erreur}</p>}
      <button className="bigbtn" disabled={!!manque || envoi} onClick={valider}>{envoi ? "Enregistrement…" : manque ?? "Valider"}</button>
    </div>
  );
}
