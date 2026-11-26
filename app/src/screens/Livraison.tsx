import { useEffect, useId, useMemo, useState } from "react";
import type { FamilleFrais, Fournisseur, LivraisonJour } from "../types";
import type { Entree } from "../hors-ligne/stockage";
import { nouvelId, useContexte, useEnregistrer } from "../contexte";
import {
  BORNES_LIVRAISON, cheminPhoto, DECISIONS_LIVRAISON, familleOk, famillesAMesurer, LIBELLE_PRODUITS, MIN, temperaturesDemandees, PROBLEMES_LIVRAISON,
  SEUILS_FAMILLES, SEUILS_LIVRAISON, trierFournisseurs, verdictLivraison,
} from "../logique";
import type { Minuteur } from "../minuteurs";
import { compresserPhoto } from "../photos";
import { useRangerLivraison } from "../rangement";
import { duree, PaveNumerique, temp, useMaintenant, useToast } from "../ui/outils";

// Produits frais : une température par famille (poisson, viande, laitiers, légumes), chacune avec ses seuils.
type Champ = "camion" | "surgele" | FamilleFrais;
const estFamille = (k: Champ): k is FamilleFrais => k in SEUILS_FAMILLES;
const libelle = (k: Champ) => (estFamille(k) ? SEUILS_FAMILLES[k].libelle : k === "camion" ? "Camion" : "Surgelés");
const seuil = (k: Champ) => (estFamille(k) ? `${temp(SEUILS_FAMILLES[k].min)} à ${temp(SEUILS_FAMILLES[k].max)}` : `max ${temp(SEUILS_LIVRAISON[k])}`);
const champOk = (k: Champ, v: number) => (estFamille(k) ? familleOk(k, v) : v <= SEUILS_LIVRAISON[k]);
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/**
 * Livraisons : la liste du jour (fournisseurs attendus en premier, livraisons reçues à ranger),
 * puis la réception sur une seule page, avec un verdict calculé (jamais choisi).
 */
export function Livraison({ onFini, lancerMinuteur, minuteurs, retirerMinuteur, enAttente = [] }: {
  onFini: () => void; lancerMinuteur: (m: Minuteur) => void; minuteurs: Minuteur[]; retirerMinuteur: (id: string) => void; enAttente?: Entree[];
}) {
  const [four, setFour] = useState<Fournisseur | null>(null);
  if (four) return <Reception four={four} onAnnuler={() => setFour(null)} onFini={() => setFour(null)} lancerMinuteur={lancerMinuteur} />;
  return <ListeDuJour onRetour={onFini} onChoisir={setFour} minuteurs={minuteurs} retirerMinuteur={retirerMinuteur} enAttente={enAttente} />;
}

/* ---------- Liste du jour ---------- */

function ListeDuJour({ onRetour, onChoisir, minuteurs, retirerMinuteur, enAttente }: {
  onRetour: () => void; onChoisir: (f: Fournisseur) => void; minuteurs: Minuteur[]; retirerMinuteur: (id: string) => void; enAttente: Entree[];
}) {
  const { api } = useContexte();
  const toast = useToast();
  const ranger = useRangerLivraison(minuteurs, retirerMinuteur);
  const maintenant = useMaintenant(15_000);
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [serveur, setServeur] = useState<LivraisonJour[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    api.fournisseurs().then(setFournisseurs).catch((e) => setErreur(e.message));
    api.livraisonsDuJour().then(setServeur).catch(() => setServeur([]));
  }, [api]);

  // Les saisies encore sur la tablette (hors ligne ou en cours d'envoi) apparaissent tout de suite.
  const recues = useMemo(() => {
    const l = serveur.map((x) => ({ ...x }));
    for (const { op } of enAttente.filter((e) => e.statut === "attente")) {
      if (op.type === "livraison" && !l.some((x) => x.id === op.id)) {
        l.push({ id: op.id, fournisseur: op.fournisseur_nom, at: op.at_client, t_camion: op.t_camion, conforme: op.conforme, action: op.action ?? null,
          produits_refuses: op.produits_refuses ?? null, pages: 1 + (op.photos_bl_suite?.length ?? 0), range_at: null });
      }
      if (op.type === "livraison_rangee") { const x = l.find((y) => y.id === op.livraison_id); if (x && !x.range_at) x.range_at = op.at_client; }
    }
    return l.sort((a, b) => a.at.localeCompare(b.at));
  }, [serveur, enAttente]);
  const tries = trierFournisseurs(fournisseurs);

  return (
    <div className="screen">
      <button className="back" onClick={onRetour}>← Retour</button>
      <h1>Livraisons du jour</h1>
      {erreur && <p className="pill bad">{erreur}</p>}
      <section className="card">
        <h2 className="liv-titre">Un camion arrive ? Touchez le fournisseur</h2>
        <div className="liv-fournisseurs">
          {tries.map((f) => (
            <button key={f.id} className={`liv-four ${f.attendu ? "attendu" : ""}`} onClick={() => onChoisir(f)}>
              <b>{f.nom}</b>
              <span>{[f.attendu && "attendu aujourd'hui", ...(f.produits ?? []).map((p) => LIBELLE_PRODUITS[p] ?? p), f.viande && "viande"].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="card">
        <h2 className="liv-titre">Déjà reçues aujourd'hui</h2>
        {!recues.length && <p className="hint">Aucune livraison reçue pour l'instant.</p>}
        {recues.map((l) => {
          const m = minuteurs.find((x) => x.type === "rangement" && x.ref === l.id);
          const refuseTout = l.action === "Tout refusé";
          const [statut, cls] = l.conforme ? ["Conforme", "ok"] : refuseTout ? ["Tout refusé", "bad"] : l.action === "Une partie refusée" ? ["Refus partiel", "bad"] : ["Sous réserve", "warn"];
          return (
            <div key={l.id} className="liv-ligne">
              <span className="hint num">{heure(l.at)}</span>
              <span><b>{l.fournisseur}</b> <span className="hint">· camion {temp(l.t_camion)} · BL {l.pages} page{l.pages > 1 ? "s" : ""}{l.produits_refuses ? ` · refusé : ${l.produits_refuses}` : ""}</span></span>
              <span className={`pill ${cls}`}>{statut}</span>
              {l.range_at || refuseTout
                ? <span className="hint">{refuseTout ? "rien à ranger" : `rangée à ${heure(l.range_at!)}`}</span>
                : <span className="liv-ranger">
                    {m && <span className={`hint ${maintenant - m.debut > m.duree ? "t-bad" : ""}`}>{duree(Math.abs(m.debut + m.duree - maintenant))} {maintenant - m.debut > m.duree ? "de retard" : "restantes"}</span>}
                    <button className="opt sel" onClick={async () => { await ranger(l.id, l.fournisseur); toast("Livraison rangée"); }}>C'est rangé</button>
                  </span>}
            </div>
          );
        })}
      </section>
    </div>
  );
}

/* ---------- Réception sur une page ---------- */

function Reception({ four, onAnnuler, onFini, lancerMinuteur }: { four: Fournisseur; onAnnuler: () => void; onFini: () => void; lancerMinuteur: (m: Minuteur) => void }) {
  const { api, site } = useContexte();
  const enregistrer = useEnregistrer();
  const toast = useToast();
  // Ce que le fournisseur ne livre pas est pré-rempli « Aucun » (toujours modifiable en touchant la case).
  const demandees = temperaturesDemandees(four.produits);
  const familles = famillesAMesurer(four);
  const champs: Champ[] = ["camion", ...familles, "surgele"];
  const [t, setT] = useState<Partial<Record<Champ, number | "aucun">>>(() => (demandees.surgele ? {} : { surgele: "aucun" as const }));
  const [pave, setPave] = useState<Champ | null>(null);
  const [pages, setPages] = useState<Blob[]>([]);
  const [rien, setRien] = useState(false);
  const [problemes, setProblemes] = useState<string[]>([]);
  const [origine, setOrigine] = useState<boolean | null>(null);
  const [decision, setDecision] = useState<string | null>(null);
  const [refuses, setRefuses] = useState("");
  const [photoNc, setPhotoNc] = useState<Blob | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const num = (k: Champ) => (typeof t[k] === "number" ? (t[k] as number) : undefined);
  const produits = Object.fromEntries(familles.filter((f) => typeof t[f] === "number").map((f) => [f, t[f] as number])) as Partial<Record<FamilleFrais, number>>;
  const v = verdictLivraison({ camion: num("camion"), produits, surgele: num("surgele"), problemes, viande: !!four.viande, origine });
  const tempsOk = champs.every((k) => t[k] !== undefined);
  const controleOk = rien || problemes.length > 0;
  const origineOk = !four.viande || origine !== null;
  // Une réponse donnée quand la livraison semblait non conforme ne compte plus si elle redevient conforme (température corrigée).
  const dec = v.conforme ? null : decision;
  const decisionOk = v.conforme || (!!dec && (dec !== "Une partie refusée" || refuses.trim().length >= 3));
  const etapesOk = tempsOk && pages.length > 0 && controleOk && origineOk;
  const pret = etapesOk && decisionOk;
  const manque = !tempsOk ? "Mesurez les températures" : !pages.length ? "Photographiez le bon de livraison" : !controleOk ? "Contrôle des produits : rien à signaler ?"
    : !origineOk ? "Origine de la viande ?" : !decisionOk ? (dec === "Une partie refusée" ? "Notez les produits refusés" : "Indiquez ce que vous avez fait") : null;

  async function valider() {
    if (!pret || typeof t.camion !== "number") return;
    setEnvoi(true); setErreur(null);
    try {
      const id = nouvelId(), maintenant = Date.now();
      const photos = pages.map((blob) => ({ chemin: cheminPhoto(site.id, nouvelId(), maintenant), blob }));
      const nc = photoNc ? { chemin: cheminPhoto(site.id, nouvelId(), maintenant), blob: photoNc } : null;
      await enregistrer({
        type: "livraison", id, fournisseur_id: four.id, fournisseur_nom: four.nom,
        t_camion: t.camion, t_produits: Object.keys(produits).length ? produits : undefined, t_surgele: num("surgele"),
        photo_bl: photos[0].chemin, photos_bl_suite: photos.slice(1).map((p) => p.chemin),
        viande: !!four.viande, origine_ok: four.viande ? origine ?? undefined : undefined,
        conforme: v.conforme, motifs: v.conforme ? undefined : v.motifs, action: v.conforme ? undefined : dec ?? undefined,
        produits_refuses: !v.conforme && refuses.trim() ? refuses.trim() : undefined, photo_nc: nc?.chemin,
      }, nc ? [...photos, nc] : photos);
      if (!v.conforme) await enregistrer({ type: "anomalies", lignes: [{
        id: nouvelId(), source: "livraison", ref_id: id, categorie: "Livraison", gravite: v.graveTemperature ? "majeure" : "mineure",
        titre: `Livraison ${four.nom} non conforme : ${v.motifs.join(", ")} · ${dec}${refuses.trim() ? ` (${refuses.trim()})` : ""}`, photo: nc?.chemin,
      }] });
      if (dec === "Tout refusé") {
        await enregistrer({ type: "livraison_rangee", livraison_id: id });   // rien à ranger : pas de minuteur
        toast("Livraison refusée enregistrée");
      } else {
        lancerMinuteur({ id: nouvelId(), type: "rangement", libelle: `Rangement · ${four.nom}`, debut: maintenant, duree: 15 * MIN, alerte: 10 * MIN, ref: id, donnees: { fournisseur: four.nom } });
        toast("Livraison enregistrée · rangement : 15 min");
      }
      onFini();
    } catch (e) { setErreur((e as Error).message); setEnvoi(false); }
  }

  const basculer = (p: string) => { setRien(false); setProblemes(problemes.includes(p) ? problemes.filter((x) => x !== p) : [...problemes, p]); };

  return (
    <div className="screen reception">
      <div className="reception-tete">
        <button className="back" onClick={onAnnuler}>← Annuler</button>
        <h1>Réception {four.nom}</h1>
        <span className="hint">{[...(four.produits ?? []).map((p) => LIBELLE_PRODUITS[p] ?? p), four.viande && "viande"].filter(Boolean).join(" · ")}</span>
      </div>

      <div className="reception-haut">
        <section className="card">
          <h2 className="liv-titre">1 · Températures</h2>
          <div className="liv-temps">
            {champs.map((k) => {
              const val = t[k], mesure = typeof val === "number", ko = mesure && !champOk(k, val as number);
              return (
                <div key={k} className="liv-temp-case">
                  <button className={`liv-temp ${val === undefined ? "" : val === "aucun" ? "aucun" : ko ? "bad" : "ok"}`} onClick={() => setPave(k)}>
                    <span>{libelle(k)} · {seuil(k)}</span>
                    <b>{val === undefined ? "Mesurer" : val === "aucun" ? "Aucun" : temp(val as number)}</b>
                  </button>
                  {k !== "camion" && val === undefined && <button className="lien" onClick={() => setT({ ...t, [k]: "aucun" })}>{estFamille(k) ? SEUILS_FAMILLES[k].aucun : "Pas de surgelés"}</button>}
                </div>
              );
            })}
          </div>
        </section>
        <section className="card">
          <h2 className="liv-titre">2 · Bon de livraison</h2>
          <PagesBL pages={pages} onAjouter={(b) => setPages([...pages, b])} onRetirer={(i) => setPages(pages.filter((_, j) => j !== i))} demo={api.mode === "demo"} />
        </section>
      </div>

      <section className="card">
        <h2 className="liv-titre">3 · Contrôle des produits</h2>
        <div className="opts">
          <button className={`opt ${rien ? "sel ok" : ""}`} onClick={() => { setRien(true); setProblemes([]); }}>Rien à signaler</button>
          <span className="hint" style={{ alignSelf: "center" }}>ou un problème :</span>
          {PROBLEMES_LIVRAISON.map((p) => <button key={p} className={`opt ${problemes.includes(p) ? "sel" : ""}`} onClick={() => basculer(p)}>{p}</button>)}
        </div>
        {four.viande && (
          <div className="liv-viande">
            <b>Viande : origine indiquée (pays d'élevage et d'abattage) ?</b>
            <button className={`opt ${origine === true ? "sel ok" : ""}`} onClick={() => setOrigine(true)}>Oui</button>
            <button className={`opt ${origine === false ? "sel" : ""}`} onClick={() => setOrigine(false)}>Non, elle manque</button>
          </div>
        )}
      </section>

      {etapesOk && (v.conforme
        ? <div className="liv-verdict ok"><b>Livraison conforme</b> · calculé automatiquement</div>
        : <>
            <div className="liv-verdict bad"><b>Non conforme : {v.motifs.join(", ").toLowerCase()}</b> · détecté automatiquement</div>
            <section className="card liv-decision">
              <h2 className="liv-titre">4 · Qu'avez-vous fait ? (obligatoire)</h2>
              <div className="liv-decisions">
                {DECISIONS_LIVRAISON.map((d) => (
                  <button key={d.cle} className={`liv-dec ${decision === d.cle ? "sel" : ""}`} onClick={() => setDecision(d.cle)}><b>{d.cle}</b><span>{d.detail}</span></button>
                ))}
              </div>
              {decision && decision !== "Tout refusé" && (
                <label className="champ-bloc">{decision === "Une partie refusée" ? "Produits refusés (obligatoire)" : "Réserve notée (facultatif)"}
                  <input className="champ" value={refuses} onChange={(e) => setRefuses(e.target.value)} placeholder={decision === "Une partie refusée" ? "Ex. salade, tomates cerises" : "Ex. carton écrasé, à vérifier"} />
                </label>
              )}
              {decision && <PagesBL pages={photoNc ? [photoNc] : []} max={1} libelle="Photo du problème (facultatif)" onAjouter={setPhotoNc} onRetirer={() => setPhotoNc(null)} demo={api.mode === "demo"} />}
            </section>
          </>)}

      {erreur && <p className="pill bad">{erreur}</p>}
      <button className="bigbtn" disabled={!pret || envoi} onClick={valider}>
        {envoi ? "Enregistrement…" : manque ?? (dec === "Tout refusé" ? "Valider le refus" : "Valider · lancer le rangement (15 min)")}
      </button>
      {pave && (
        <PaveNumerique titre={`${libelle(pave)} · ${seuil(pave)}`} unite="°C" signe bornes={BORNES_LIVRAISON[estFamille(pave) ? "frais" : pave]}
          onFermer={() => setPave(null)} onValider={(x) => { setT({ ...t, [pave]: x }); setPave(null); }} />
      )}
    </div>
  );
}

/** Pages photographiées (bon de livraison sur plusieurs pages, ou photo d'un problème). */
function PagesBL({ pages, onAjouter, onRetirer, demo, max = 6, libelle }: {
  pages: Blob[]; onAjouter: (b: Blob) => void; onRetirer: (i: number) => void; demo?: boolean; max?: number; libelle?: string;
}) {
  const id = useId();
  const [urls, setUrls] = useState<string[]>([]);
  const [traitement, setTraitement] = useState(false);
  useEffect(() => {
    const u = pages.map((p) => URL.createObjectURL(p));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [pages]);
  async function choisir(f: File | undefined) {
    if (!f) return;
    setTraitement(true);
    try { onAjouter(await compresserPhoto(f)); } finally { setTraitement(false); }
  }
  function simuler() {
    const c = document.createElement("canvas"); c.width = 240; c.height = 320;
    const g = c.getContext("2d")!; g.fillStyle = "#f4f6f8"; g.fillRect(0, 0, 240, 320);
    g.fillStyle = "#14202b"; g.font = "22px sans-serif"; g.fillText(`Page ${pages.length + 1}`, 70, 160);
    c.toBlob((b) => b && onAjouter(b), "image/webp", 0.7);
  }
  return (
    <div className="liv-pages">
      {libelle && <b className="liv-pages-libelle">{libelle}</b>}
      {urls.map((u, i) => (
        <div key={u} className="liv-page" style={{ backgroundImage: `url(${u})` }}>
          <span>{max > 1 ? `page ${i + 1}` : "photo"}</span>
          <button aria-label="Retirer cette photo" onClick={() => onRetirer(i)}>×</button>
        </div>
      ))}
      {pages.length < max && (
        <label htmlFor={id} className="liv-page ajout">{traitement ? "…" : pages.length ? "+ page" : max > 1 ? "Photo du BL" : "+ photo"}
          <input id={id} type="file" accept="image/*" capture="environment" onChange={(e) => { void choisir(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      )}
      {demo && pages.length < max && <button type="button" className="sim" onClick={simuler}>Simuler</button>}
    </div>
  );
}
