import { useState } from "react";
import type { Anomalie, Gravite, Tache } from "../types";
import { nouvelId, useContexte, useEnregistrer } from "../contexte";
import { cheminPhoto, REGLES_MINUTEUR, transitionPermise } from "../logique";
import type { Minuteur } from "../minuteurs";
import { ChampPhoto } from "../ui/Photo";
import { duree, PaveNumerique, temp, useMaintenant, useToast } from "../ui/outils";

const PLATS = ["Sauce bolognaise", "Chili", "Riz", "Soupe du jour", "Effiloché de porc", "Autre"];

/** Lancer un minuteur de refroidissement rapide ou de remise en température. */
export function LancerMinuteur({ onFini, lancer }: { onFini: () => void; lancer: (m: Minuteur) => void }) {
  const toast = useToast();
  const [type, setType] = useState<"refroidissement" | "remise_temperature" | null>(null);
  const [plat, setPlat] = useState<string | null>(null);
  const [tDebut, setTDebut] = useState<number | null>(null);
  const [pave, setPave] = useState(false);
  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>Lancer un minuteur</h1>
      <div className="opts">
        <button className={`opt big ${type === "refroidissement" ? "sel" : ""}`} onClick={() => setType("refroidissement")}>Refroidissement rapide<br /><small style={{ fontFamily: "var(--body)", fontSize: 15 }}>sous +10 °C en 2 h</small></button>
        <button className={`opt big ${type === "remise_temperature" ? "sel" : ""}`} onClick={() => setType("remise_temperature")}>Remise en température<br /><small style={{ fontFamily: "var(--body)", fontSize: 15 }}>+63 °C en 1 h</small></button>
      </div>
      {type && <>
        <div className="card"><b>Quel plat ?</b>
          <div className="opts" style={{ marginTop: 10 }}>{PLATS.map((p) => <button key={p} className={`opt ${plat === p ? "sel" : ""}`} onClick={() => setPlat(p)}>{p}</button>)}</div>
        </div>
        <div className="row"><span className="n">Température de départ</span><span />
          <button className={`val num ${tDebut !== null ? "filled" : ""}`} onClick={() => setPave(true)}>{tDebut !== null ? temp(tDebut) : "Saisir"}</button>
        </div>
      </>}
      <button className="bigbtn" disabled={!type || !plat || tDebut === null} onClick={() => {
        const r = REGLES_MINUTEUR[type!];
        lancer({
          id: nouvelId(), type: type!, libelle: `${type === "refroidissement" ? "Refroidissement" : "Remise en T°"} · ${plat!.toLowerCase()}`,
          debut: Date.now(), duree: r.duree, alerte: r.alerte, donnees: { plat, t_debut: tDebut },
        });
        toast("Minuteur lancé");
        onFini();
      }}>Lancer le minuteur</button>
      {pave && <PaveNumerique titre="Température de départ" unite="°C" signe={false} onFermer={() => setPave(false)} onValider={(v) => { setTDebut(v); setPave(false); }} />}
    </div>
  );
}

/** Feuille affichée quand un refroidissement ou une remise en température est raté : que fait-on du produit ? */
export function FeuilleNonConforme({ m, tFin, ecoule, onChoix, onFermer }: {
  m: Minuteur; tFin: number; ecoule: number; onChoix: (action: string) => void; onFermer: () => void;
}) {
  const refroid = m.type === "refroidissement";
  return (
    <div id="sheet" className="open" role="dialog" aria-modal="true">
      <div className="pad" style={{ width: "min(560px,100%)" }}>
        <h3 style={{ color: "var(--bad)" }}>{refroid ? "Refroidissement non conforme" : "Remise en température non conforme"}</h3>
        <p className="hint">{temp(tFin)} après {duree(ecoule)}. {refroid ? "Il fallait passer sous +10 °C en moins de 2 h." : "Il fallait atteindre +63 °C en moins d'1 h."} Qu'avez-vous fait du produit ?</p>
        <div className="opts" style={{ flexDirection: "column" }}>
          {["Produit jeté", "Avis du chef demandé"].map((a) => <button key={a} className="opt big" onClick={() => onChoix(a)}>{a}</button>)}
        </div>
        <button className="bigbtn ghost" onClick={onFermer}>Annuler</button>
      </div>
    </div>
  );
}

/** Signaler un problème : photo, catégorie, gravité, commentaire. */
export function Signaler({ onFini, categorie }: { onFini: () => void; categorie?: string }) {
  const { api, site } = useContexte();
  const enregistrer = useEnregistrer();
  const toast = useToast();
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [cat, setCat] = useState<string | null>(categorie ?? null);
  const [grav, setGrav] = useState<Gravite | null>(null);
  const [com, setCom] = useState("");
  const [envoi, setEnvoi] = useState(false);
  async function envoyer() {
    if (!cat || !grav) return;
    setEnvoi(true);
    const chemin = photo ? cheminPhoto(site.id, nouvelId(), Date.now()) : undefined;
    await enregistrer({ type: "anomalies", lignes: [{ id: nouvelId(), source: "manuel", categorie: cat, gravite: grav, titre: com.trim() || cat, photo: chemin }] },
      photo && chemin ? [{ chemin, blob: photo }] : []);
    toast(grav === "critique" ? "Anomalie critique envoyée : le siège est prévenu" : "Anomalie envoyée");
    onFini();
  }
  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>Signaler un problème</h1>
      <ChampPhoto texte="Photo du problème" photo={photo} onPhoto={setPhoto} demo={api.mode === "demo"} />
      <div className="card"><b>C'est quoi ?</b>
        <div className="opts" style={{ margin: "10px 0 16px" }}>
          {["Température", "Nuisibles", "Matériel en panne", "Propreté", "Produit", "Autre"].map((x) => <button key={x} className={`opt ${cat === x ? "sel" : ""}`} onClick={() => setCat(x)}>{x}</button>)}
        </div>
        <b>C'est grave ?</b>
        <div className="opts" style={{ margin: "10px 0 16px" }}>
          <button className={`opt ${grav === "mineure" ? "sel" : ""}`} onClick={() => setGrav("mineure")}>Mineur · à traiter sous 3 jours</button>
          <button className={`opt ${grav === "majeure" ? "sel" : ""}`} onClick={() => setGrav("majeure")}>Majeur · à traiter aujourd'hui</button>
          <button className={`opt ${grav === "critique" ? "sel" : ""}`} style={grav === "critique" ? undefined : { color: "var(--bad)" }} onClick={() => setGrav("critique")}>Critique · siège prévenu tout de suite</button>
        </div>
        <label htmlFor="com"><b>En quelques mots (facultatif)</b></label>
        <textarea id="com" value={com} onChange={(e) => setCom(e.target.value)} maxLength={500} placeholder="Ex. : souris vue derrière le four mixte" />
      </div>
      <button className="bigbtn" disabled={!cat || !grav || envoi} onClick={envoyer}>Envoyer</button>
    </div>
  );
}

/** Liste des anomalies du site, avec traitement (tous) et vérification (chef, responsable). */
export function Anomalies({ anomalies, onRetour }: { anomalies: Anomalie[]; onRetour: () => void }) {
  const { profil } = useContexte();
  const enregistrer = useEnregistrer();
  const toast = useToast();
  const maintenant = useMaintenant(30_000);
  const [traiter, setTraiter] = useState<Anomalie | null>(null);
  const [com, setCom] = useState("");

  async function changer(a: Anomalie, statut: "traitee" | "verifiee", commentaire?: string) {
    await enregistrer({ type: "anomalie_statut", anomalie_id: a.id, statut, commentaire });
    toast(statut === "traitee" ? "Anomalie traitée" : "Anomalie vérifiée et clôturée");
  }

  return (
    <div className="screen">
      <button className="back" onClick={onRetour}>← Retour</button>
      <h1>Anomalies du site</h1>
      <p className="hint">Ouverte → Traitée → Vérifiée par le chef. Majeure non traitée sous 24 h, mineure sous 72 h : le siège est prévenu.</p>
      <div className="rows">
        {anomalies.length === 0 && <p className="hint">Aucune anomalie ouverte.</p>}
        {anomalies.map((a) => (
          <div key={a.id} className={`anom g-${a.gravite}`}>
            <span className="stripe" />
            <span><b>{a.titre}</b><br /><span className="hint" style={{ fontSize: 15 }}>{a.categorie} · {a.gravite} · il y a {duree(maintenant - Date.parse(a.cree_at))}</span></span>
            <span style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              <span className={`pill ${a.statut === "ouverte" ? "bad" : "warn"}`}>{a.statut === "ouverte" ? "Ouverte" : "Traitée"}</span>
              {a.enAttente && <span className="pill none">En attente d'envoi</span>}
              {transitionPermise(a.statut, "traitee", profil.role) && <button className="opt" onClick={() => { setTraiter(a); setCom(""); }}>Marquer traitée</button>}
              {transitionPermise(a.statut, "verifiee", profil.role) && <button className="opt" onClick={() => changer(a, "verifiee")}>Vérifiée (clôturer)</button>}
              {a.statut === "traitee" && profil.role === "equipe" && <span className="hint" style={{ fontSize: 14 }}>À vérifier par le chef</span>}
            </span>
          </div>
        ))}
      </div>
      {traiter && (
        <div id="sheet" className="open" role="dialog" aria-modal="true">
          <div className="pad" style={{ width: "min(560px,100%)" }}>
            <h3>Qu'avez-vous fait ?</h3>
            <p className="hint">{traiter.titre}</p>
            <label htmlFor="trait" className="hint">Action réalisée (facultatif)</label>
            <textarea id="trait" value={com} onChange={(e) => setCom(e.target.value)} maxLength={500} placeholder="Ex. : joint remplacé, technicien passé" />
            <div className="btnrow">
              <button className="bigbtn ghost" onClick={() => setTraiter(null)}>Annuler</button>
              <button className="bigbtn ok" onClick={async () => { await changer(traiter, "traitee", com.trim() || undefined); setTraiter(null); }}>Traitée</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tâche simple (tour des DLC, nettoyage) : c'est fait, ou je signale un problème. */
export function TacheSimple({ tache, onFini, onProbleme }: { tache: Tache; onFini: () => void; onProbleme: () => void }) {
  const enregistrer = useEnregistrer();
  const toast = useToast();
  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>{tache.titre}</h1>
      <div className="btnrow">
        <button className="bigbtn ok" onClick={async () => { await enregistrer({ type: "terminer_tache", tache_id: tache.id }); toast("C'est noté"); onFini(); }}>C'est fait</button>
        <button className="bigbtn bad" onClick={onProbleme}>Problème : signaler</button>
      </div>
    </div>
  );
}
