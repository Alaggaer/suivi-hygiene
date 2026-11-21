import { useEffect, useState } from "react";
import type { Api, ElementATaire, ProduitEntretien, Tache, TacheNettoyage } from "../types";
import type { Entree } from "../hors-ligne/stockage";
import { nouvelId, useContexte, useEnregistrer } from "../contexte";
import { cheminPhoto } from "../logique";
import { lireFiche } from "../fiches";
import { ChampPhoto } from "../ui/Photo";
import { hm, useToast } from "../ui/outils";

/** Coches encore sur la tablette, ajoutées à celles du serveur. */
export function avecCochesEnAttente(t: TacheNettoyage, entrees: Entree[]): TacheNettoyage {
  const loc = new Map(entrees.flatMap(({ op, statut }) => statut === "attente" && op.type === "nettoyage_fait" && op.tache_id === t.tache_id
    ? [[op.element_id, { par: op.par_nom, at: op.at_client, photo: op.photo ?? null }] as const] : []));
  return loc.size ? { ...t, elements: t.elements.map((e) => (e.fait || !loc.has(e.id) ? e : { ...e, fait: loc.get(e.id)! })) } : t;
}

/** Ouvre une FT ou une FDS : image à l'écran, PDF dans le lecteur de la tablette. Marche sans réseau si la fiche est gardée. */
export function useFiche(api: Api) {
  const [image, setImage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const ouvrir = async (chemin: string) => {
    setErreur(null);
    try {
      const b = await lireFiche(api, chemin), url = URL.createObjectURL(b);
      if (b.type.startsWith("image/")) setImage(url); else window.open(url, "_blank", "noopener");
    } catch { setErreur("Fiche pas encore enregistrée sur cette tablette : réessayez une fois connecté."); }
  };
  const Vue = () => (<>
    {erreur && <p className="pill bad">{erreur}</p>}
    {image && <div className="visionneuse" onClick={() => setImage(null)} role="dialog" aria-label="Fiche"><img src={image} alt="Fiche produit" /><button className="opt">Fermer</button></div>}
  </>);
  return { ouvrir, Vue };
}

function Produit({ p, ouvrir }: { p: NonNullable<ElementATaire["produit"]> | ProduitEntretien; ouvrir: (c: string) => void }) {
  return (
    <span className="pn-produit">
      <b>{p.nom}</b>{[p.dilution, p.temps_contact && `laisser agir ${p.temps_contact}`].filter(Boolean).map((x) => <span key={x}> · {x}</span>)}
      {p.fds && <button className="pn-fiche" onClick={() => ouvrir(p.fds!)}>FDS</button>}
      {p.ft && <button className="pn-fiche" onClick={() => ouvrir(p.ft!)}>FT</button>}
    </span>
  );
}

/** Une tâche de nettoyage : chaque élément de la zone, coché un par un (photo quand le plan la demande). */
export function Nettoyage({ tache, onFini, onProduits, enAttente = [] }: { tache: Tache; onFini: () => void; onProduits: () => void; enAttente?: Entree[] }) {
  const { api, site } = useContexte();
  const enregistrer = useEnregistrer();
  const toast = useToast();
  const fiche = useFiche(api);
  const [donnees, setDonnees] = useState<TacheNettoyage | null | undefined>(undefined);
  const [photoPour, setPhotoPour] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [cochesIci, setCochesIci] = useState<Map<string, { par: string; at: string; photo: string | null }>>(new Map());
  const { profil } = useContexte();
  useEffect(() => { api.nettoyageDuJour().then((l) => setDonnees(l.find((x) => x.tache_id === tache.id) ?? null)).catch(() => setDonnees(null)); }, [api, tache.id]);

  if (donnees === undefined) return <div className="screen"><p className="hint">Chargement…</p></div>;
  if (donnees === null) return (
    <div className="screen"><button className="back" onClick={onFini}>← Retour</button><h1>{tache.titre}</h1>
      <p className="pill bad">Le détail de cette tâche n'est pas disponible sur la tablette. Reconnectez-vous au réseau puis réessayez.</p></div>
  );
  const base = avecCochesEnAttente(donnees, enAttente);
  // Ce qui vient d'être coché ici reste coché, même une fois parti au serveur.
  const t = { ...base, elements: base.elements.map((e) => (e.fait || !cochesIci.has(e.id) ? e : { ...e, fait: cochesIci.get(e.id)! })) };
  const restants = t.elements.filter((e) => !e.fait).length;

  async function cocher(e: ElementATaire, b: Blob | null) {
    setEnvoi(true);
    try {
      const chemin = b ? cheminPhoto(site.id, nouvelId(), Date.now()) : undefined;
      await enregistrer({ type: "nettoyage_fait", id: nouvelId(), tache_id: t.tache_id, element_id: e.id, photo: chemin }, b && chemin ? [{ chemin, blob: b }] : []);
      setCochesIci((m) => new Map(m).set(e.id, { par: profil.nom, at: new Date().toISOString(), photo: chemin ?? null }));
      setPhotoPour(null); setPhoto(null);
      if (restants === 1) { toast(`${tache.titre} : terminé`); onFini(); }
    } finally { setEnvoi(false); }
  }

  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>{tache.titre} <small className="hint">avant {hm(t.echeance)}</small></h1>
      <p className="hint">{restants ? `${restants} élément${restants > 1 ? "s" : ""} sur ${t.elements.length} à faire. Touchez « Fait » au fur et à mesure.` : "Tout est fait."}</p>
      <fiche.Vue />
      <div className="pn-liste">
        {t.elements.map((e) => (
          <section key={e.id} className={`card pn-el ${e.fait ? "fait" : ""}`}>
            <div className="pn-tete">
              <div>
                <h2>{e.element}</h2>
                {e.produit && <Produit p={e.produit} ouvrir={fiche.ouvrir} />}
                {e.methode && <p className="pn-methode">{e.methode}</p>}
              </div>
              {e.fait
                ? <span className="pn-ok">Fait<br /><small>{e.fait.par} · {hm(e.fait.at)}</small></span>
                : e.photo_obligatoire
                  ? <button className="opt sel" onClick={() => { setPhotoPour(e.id); setPhoto(null); }}>Photo et fait</button>
                  : <button className="bigbtn pn-fait" disabled={envoi} onClick={() => cocher(e, null)}>Fait</button>}
            </div>
            {photoPour === e.id && !e.fait && (
              <div className="pn-photo">
                <ChampPhoto texte="Photo du nettoyage effectué" photo={photo} onPhoto={setPhoto} demo={api.mode === "demo"} />
                <div className="opts">
                  <button className="opt" onClick={() => setPhotoPour(null)}>Annuler</button>
                  <button className="bigbtn" disabled={!photo || envoi} onClick={() => cocher(e, photo)}>{photo ? "Valider" : "Prenez la photo"}</button>
                </div>
              </div>
            )}
          </section>
        ))}
      </div>
      <button className="opt" onClick={onProduits}>Toutes les fiches produits d'entretien</button>
    </div>
  );
}

/** Fiches des produits d'entretien (FT, FDS), consultables à tout moment, même sans réseau. */
export function ProduitsEntretien({ onFini }: { onFini: () => void }) {
  const { api } = useContexte();
  const fiche = useFiche(api);
  const [liste, setListe] = useState<ProduitEntretien[] | null>(null);
  useEffect(() => { api.produitsEntretien().then((l) => setListe(l.filter((p) => p.actif))).catch(() => setListe([])); }, [api]);
  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>Produits d'entretien</h1>
      <p className="hint">En cas de projection ou d'ingestion, ouvrez la FDS (rubrique 4 : premiers secours). Urgence : 15 ou 112.</p>
      <fiche.Vue />
      {!liste && <p className="hint">Chargement…</p>}
      {liste?.length === 0 && <p className="hint">Aucun produit enregistré par le siège.</p>}
      {liste?.map((p) => (
        <section key={p.id} className="card pn-el">
          <Produit p={p} ouvrir={fiche.ouvrir} />
          {p.usage && <p className="pn-methode">{p.usage}</p>}
          {!p.ft && !p.fds && <p className="hint">Fiches pas encore déposées par le siège.</p>}
        </section>
      ))}
    </div>
  );
}
