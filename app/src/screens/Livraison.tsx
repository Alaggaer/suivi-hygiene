import { useEffect, useState } from "react";
import type { Fournisseur } from "../types";
import { nouvelId, useContexte, useEnregistrer } from "../contexte";
import { cheminPhoto, MIN, SEUILS_LIVRAISON, temperaturesLivraisonOk } from "../logique";
import type { Minuteur } from "../minuteurs";
import { ChampPhoto } from "../ui/Photo";
import { PaveNumerique, temp, useToast } from "../ui/outils";

const MOTIFS = ["Température", "Emballage abîmé", "DLC trop courte", "Produit manquant", "Produit non commandé", "Origine viande absente"];
const ACTIONS = ["Produit refusé", "Accepté sous réserve"];
type Champ = "camion" | "frais" | "surgele";
const LIBELLES: Record<Champ, string> = { camion: "Température du camion", frais: "Produits frais (1 produit au hasard)", surgele: "Produits surgelés (si livrés)" };

export function Livraison({ onFini, lancerMinuteur }: { onFini: () => void; lancerMinuteur: (m: Minuteur) => void }) {
  const { api, site } = useContexte();
  const enregistrer = useEnregistrer();
  const toast = useToast();
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [etape, setEtape] = useState(1);
  const [four, setFour] = useState<Fournisseur | null>(null);
  const [t, setT] = useState<Partial<Record<Champ, number>>>({});
  const [pave, setPave] = useState<Champ | null>(null);
  const [bl, setBl] = useState<Blob | null>(null);
  const [viande, setViande] = useState<boolean | null>(null);
  const [origine, setOrigine] = useState<boolean | null>(null);
  const [conforme, setConforme] = useState<boolean | null>(null);
  const [motifs, setMotifs] = useState<string[]>([]);
  const [action, setAction] = useState<string | null>(null);
  const [photoNc, setPhotoNc] = useState<Blob | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => { api.fournisseurs().then(setFournisseurs).catch((e) => setErreur(e.message)); }, [api]);

  const temperaturesOk = temperaturesLivraisonOk({ camion: t.camion, frais: t.frais, surgele: t.surgele });
  const pret = conforme === true || (conforme === false && motifs.length > 0 && action !== null);

  async function valider() {
    if (!four || !bl || t.camion === undefined) return;
    setEnvoi(true); setErreur(null);
    try {
      const id = nouvelId(), maintenant = Date.now();
      const photos = [{ chemin: cheminPhoto(site.id, nouvelId(), maintenant), blob: bl }];
      if (photoNc) photos.push({ chemin: cheminPhoto(site.id, nouvelId(), maintenant), blob: photoNc });
      await enregistrer({
        type: "livraison", id, fournisseur_id: four.id, fournisseur_nom: four.nom,
        t_camion: t.camion, t_frais: t.frais, t_surgele: t.surgele, photo_bl: photos[0].chemin,
        viande: !!viande, origine_ok: viande ? origine ?? undefined : undefined,
        conforme: !!conforme, motifs: conforme ? undefined : motifs, action: conforme ? undefined : action ?? undefined,
        photo_nc: photos[1]?.chemin,
      }, photos);
      const anomalies = [];
      if (!conforme) anomalies.push({
        id: nouvelId(), source: "livraison", ref_id: id, categorie: "Livraison",
        gravite: motifs.includes("Température") ? "majeure" as const : "mineure" as const,
        titre: `Livraison ${four.nom} non conforme : ${motifs.join(", ")} · ${action}`, photo: photos[1]?.chemin,
      });
      if (viande && origine === false) anomalies.push({
        id: nouvelId(), source: "livraison", ref_id: id, categorie: "Fournisseur", gravite: "mineure" as const,
        titre: `Origine de la viande absente · ${four.nom}`,
      });
      if (anomalies.length) await enregistrer({ type: "anomalies", lignes: anomalies });
      lancerMinuteur({ id: nouvelId(), type: "rangement", libelle: `Rangement · ${four.nom}`, debut: maintenant, duree: 15 * MIN, alerte: 10 * MIN, ref: id, donnees: { fournisseur: four.nom } });
      toast("Livraison enregistrée · minuteur de rangement lancé");
      onFini();
    } catch (e) { setErreur((e as Error).message); setEnvoi(false); }
  }

  const tete = (
    <>
      <button className="back" onClick={() => (etape > 1 ? setEtape(etape - 1) : onFini())}>← {etape > 1 ? "Étape précédente" : "Retour"}</button>
      <div className="steps" aria-label={`Étape ${etape} sur 4`}>{[1, 2, 3, 4].map((i) => <i key={i} className={i <= etape ? "on" : ""} />)}</div>
    </>
  );

  if (etape === 1) return (
    <div className="screen">{tete}<h1>Quel fournisseur ?</h1>
      {erreur && <p className="pill bad">{erreur}</p>}
      <div className="opts">{fournisseurs.map((f) => <button key={f.id} className="opt big" onClick={() => { setFour(f); setEtape(2); }}>{f.nom}</button>)}</div>
    </div>
  );

  if (etape === 2) return (
    <div className="screen">{tete}<h1>Températures · {four?.nom}</h1>
      <p className="hint">Thermomètre laser pour le camion, sonde pour les produits.</p>
      <div className="rows">
        {(["camion", "frais", "surgele"] as Champ[]).map((k) => {
          const v = t[k], a = v !== undefined, ok = a && v <= SEUILS_LIVRAISON[k];
          return (
            <div key={k} className={`row ${a && !ok ? "bad" : ""}`}>
              <span><span className="n">{LIBELLES[k]}</span><br /><span className="seuil">Maximum {temp(SEUILS_LIVRAISON[k])}</span></span>
              <span className={`pill ${a ? (ok ? "ok" : "bad") : "none"}`}>{a ? (ok ? "Conforme" : "Hors seuil") : k === "surgele" ? "Facultatif" : "À mesurer"}</span>
              <button className={`val num ${a ? "filled" : ""}`} onClick={() => setPave(k)}>{a ? temp(v) : "Saisir"}</button>
            </div>
          );
        })}
      </div>
      <button className="bigbtn" disabled={t.camion === undefined || t.frais === undefined} onClick={() => setEtape(3)}>Suivant</button>
      {pave && <PaveNumerique titre={LIBELLES[pave]} unite="°C" signe onFermer={() => setPave(null)} onValider={(v) => { setT({ ...t, [pave]: v }); setPave(null); }} />}
    </div>
  );

  if (etape === 3) return (
    <div className="screen">{tete}<h1>Bon de livraison</h1>
      <ChampPhoto texte="Photo du bon de livraison" photo={bl} onPhoto={setBl} demo={api.mode === "demo"} />
      <div className="card"><b>Il y a de la viande dans cette livraison ?</b>
        <div className="opts" style={{ marginTop: 10 }}>
          <button className={`opt ${viande === true ? "sel" : ""}`} onClick={() => setViande(true)}>Oui</button>
          <button className={`opt ${viande === false ? "sel" : ""}`} onClick={() => { setViande(false); setOrigine(null); }}>Non</button>
        </div>
        {viande && <>
          <p style={{ margin: "14px 0 8px" }}><b>L'origine (pays d'élevage et d'abattage) est indiquée sur le BL ou l'étiquette ?</b></p>
          <div className="opts">
            <button className={`opt ${origine === true ? "sel" : ""}`} onClick={() => setOrigine(true)}>Oui</button>
            <button className={`opt ${origine === false ? "sel" : ""}`} onClick={() => setOrigine(false)}>Non, elle manque</button>
          </div>
        </>}
      </div>
      <button className="bigbtn" disabled={!bl || viande === null || (viande && origine === null)} onClick={() => setEtape(4)}>Suivant</button>
    </div>
  );

  return (
    <div className="screen">{tete}<h1>La livraison est conforme ?</h1>
      {!temperaturesOk && <p className="pill bad" style={{ alignSelf: "flex-start" }}>Une température est hors seuil</p>}
      <div className="btnrow">
        <button className="bigbtn ok" aria-pressed={conforme === true} style={conforme === true ? { outline: "4px solid var(--ink)" } : undefined} onClick={() => setConforme(true)}>Oui, conforme</button>
        <button className="bigbtn bad" aria-pressed={conforme === false} style={conforme === false ? { outline: "4px solid var(--ink)" } : undefined}
          onClick={() => { setConforme(false); if (!temperaturesOk && !motifs.includes("Température")) setMotifs([...motifs, "Température"]); }}>Non</button>
      </div>
      {conforme === false && (
        <div className="card"><b>Pourquoi ?</b>
          <div className="opts" style={{ margin: "10px 0 16px" }}>
            {MOTIFS.map((m) => <button key={m} className={`opt ${motifs.includes(m) ? "sel" : ""}`} onClick={() => setMotifs(motifs.includes(m) ? motifs.filter((x) => x !== m) : [...motifs, m])}>{m}</button>)}
          </div>
          <b>Qu'avez-vous fait ?</b>
          <div className="opts" style={{ margin: "10px 0 16px" }}>
            {ACTIONS.map((a) => <button key={a} className={`opt ${action === a ? "sel" : ""}`} onClick={() => setAction(a)}>{a}</button>)}
          </div>
          <ChampPhoto texte="Photo du problème (facultatif)" photo={photoNc} onPhoto={setPhotoNc} demo={api.mode === "demo"} />
        </div>
      )}
      {conforme === true && !temperaturesOk && <p className="hint">Une température est hors seuil : vérifiez avant de déclarer la livraison conforme.</p>}
      {erreur && <p className="pill bad">{erreur}</p>}
      <button className="bigbtn" disabled={!pret || envoi} onClick={valider}>{envoi ? "Enregistrement…" : "Enregistrer la livraison"}</button>
    </div>
  );
}
