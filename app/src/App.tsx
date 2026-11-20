import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Anomalie, Api, Profil, Site, Tache } from "./types";
import type { FileEnvoi } from "./hors-ligne/file";
import type { Entree } from "./hors-ligne/stockage";
import { ContexteProvider, nouvelId, useEnregistrer, useFile } from "./contexte";
import { etatMinuteur, useMinuteurs, type Minuteur } from "./minuteurs";
import { Accueil, ListeAnomalies } from "./screens/Accueil";
import { Activation, Connexion } from "./screens/Connexion";
import { Releves } from "./screens/Releves";
import { Huile } from "./screens/Huile";
import { Livraison } from "./screens/Livraison";
import { Produit } from "./screens/Produit";
import { duree, hm, MIN, useInactivite, useMaintenant, useToast } from "./ui/outils";

type Ecran =
  | { nom: "accueil" } | { nom: "releves"; tache?: Tache } | { nom: "huile"; tache?: Tache }
  | { nom: "anomalies" } | { nom: "livraison" } | { nom: "produit" };

/** Les saisies pas encore envoyées s'affichent tout de suite : tâche cochée, anomalie listée. */
export function appliquerEnAttente(taches: Tache[], anomalies: Anomalie[], entrees: Entree[]) {
  const faites = new Map<string, { at: string; nom: string }>();
  const nouvelles: Anomalie[] = [];
  for (const { op } of entrees) {
    if ((op.type === "terminer_tache" || op.type === "releves" || op.type === "huile") && op.tache_id) faites.set(op.tache_id, { at: op.at_client, nom: op.par_nom });
    if (op.type === "anomalies") op.lignes.forEach((l) => nouvelles.push({ id: l.id, titre: l.titre, categorie: l.categorie, gravite: l.gravite, statut: "ouverte", cree_at: op.at_client, enAttente: true }));
  }
  const ids = new Set(anomalies.map((a) => a.id));
  return {
    taches: taches.map((t) => (!t.faite_at && faites.has(t.id) ? { ...t, faite_at: faites.get(t.id)!.at, faite_par_nom: faites.get(t.id)!.nom } : t)),
    anomalies: [...nouvelles.filter((a) => !ids.has(a.id)).reverse(), ...anomalies],
  };
}

export default function App({ api, file }: { api: Api; file: FileEnvoi }) {
  const toast = useToast();
  const [activee, setActivee] = useState<boolean | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [profil, setProfil] = useState<Profil | null>(null);
  const [ecran, setEcran] = useState<Ecran>({ nom: "accueil" });
  const [tachesServeur, setTaches] = useState<Tache[]>([]);
  const [anomaliesServeur, setAnomalies] = useState<Anomalie[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enLigne, setEnLigne] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const { etat: etatFile, entrees } = useFile(file);
  const minuteurs = useMinuteurs();
  const maintenant = useMaintenant(10_000);

  useEffect(() => { api.estActivee().then(setActivee); }, [api]);
  useEffect(() => { if (activee) api.site().then(setSite).catch((e) => setErreur(e.message)); }, [api, activee]);

  // Envoi de la file : au démarrage, au retour du réseau, et toutes les 30 s.
  useEffect(() => {
    const relancer = () => { setEnLigne(navigator.onLine); void file.vider(); };
    const horsLigne = () => setEnLigne(false);
    window.addEventListener("online", relancer);
    window.addEventListener("offline", horsLigne);
    void file.vider();
    const i = setInterval(() => void file.vider(), 30_000);
    return () => { window.removeEventListener("online", relancer); window.removeEventListener("offline", horsLigne); clearInterval(i); };
  }, [file]);

  const recharger = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([api.taches(), api.anomaliesOuvertes()]);
      setTaches(t); setAnomalies(a); setErreur(null);
    } catch (e) { setErreur((e as Error).message); }
  }, [api]);

  // Rechargement à la connexion, après chaque envoi réussi, et toutes les 2 minutes.
  useEffect(() => { if (!profil) return; recharger(); const i = setInterval(recharger, 2 * MIN); return () => clearInterval(i); }, [profil, recharger]);
  const attentePrec = useRef(etatFile.attente);
  useEffect(() => { if (profil && etatFile.attente < attentePrec.current) recharger(); attentePrec.current = etatFile.attente; }, [etatFile.attente, profil, recharger]);

  // Tablette partagée : retour à « Qui êtes-vous ? » après 2 minutes sans toucher l'écran.
  useInactivite(2 * MIN, !!profil, () => { setProfil(null); setEcran({ nom: "accueil" }); });

  const { taches, anomalies } = useMemo(() => appliquerEnAttente(tachesServeur, anomaliesServeur, entrees), [tachesServeur, anomaliesServeur, entrees]);

  const retour = () => { setEcran({ nom: "accueil" }); recharger(); };
  const ouvrirTache = (t: Tache) => {
    if (t.type === "releves") setEcran({ nom: "releves", tache: t });
    else if (t.type === "huile") setEcran({ nom: "huile", tache: t });
    else toast("Ce type de tâche arrive dans une prochaine version.");
  };

  let corps;
  if (activee === null) corps = <p className="hint">Chargement…</p>;
  else if (!activee) corps = <Activation api={api} onActivee={() => setActivee(true)} />;
  else if (!site) corps = <p className="hint">{erreur ?? "Chargement du restaurant…"}</p>;
  else if (!profil) corps = <Connexion api={api} onConnecte={(p) => { setProfil(p); toast(`Bonjour ${p.nom}`); }} />;
  else if (ecran.nom === "releves") corps = <Releves tache={ecran.tache} onFini={retour} />;
  else if (ecran.nom === "huile") corps = <Huile tache={ecran.tache} onFini={retour} />;
  else if (ecran.nom === "livraison") corps = <Livraison onFini={retour} lancerMinuteur={minuteurs.ajouter} />;
  else if (ecran.nom === "produit") corps = <Produit onFini={retour} />;
  else if (ecran.nom === "anomalies") corps = <ListeAnomalies anomalies={anomalies} onRetour={retour} />;
  else corps = <Accueil taches={taches} anomalies={anomalies} onTache={ouvrirTache} onAller={(n) => setEcran({ nom: n })} />;

  const contenu = (
    <div id="app">
      <div className="top">
        <span className="site">{site ? `${site.nom} · ${site.ville}` : "Suivi Hygiène"}</span>
        {profil && <span className="who">{profil.nom} <button className="chipbtn" onClick={() => { setProfil(null); setEcran({ nom: "accueil" }); }}>Changer d'utilisateur</button></span>}
        <Synchro enLigne={enLigne} attente={etatFile.attente} bloquees={etatFile.bloquees} />
        <span className="clock num">{hm(maintenant)}</span>
      </div>
      {api.mode === "demo" && <div className="demo">Mode démonstration : serveur simulé, rien n'est conservé. PIN : Karim 1234, Julie 1111, Mehdi 2222, Thomas 3333.</div>}
      {erreur && profil && <div className="demo" style={{ background: "var(--bad-bg)", color: "var(--bad)" }}>{erreur}</div>}
      {profil && <Bandeau minuteurs={minuteurs.liste} retirer={minuteurs.retirer} />}
      <main id="main">{corps}</main>
    </div>
  );
  return site && profil ? <ContexteProvider valeur={{ api, file, site, profil }}>{contenu}</ContexteProvider> : contenu;
}

function Synchro({ enLigne, attente, bloquees }: { enLigne: boolean; attente: number; bloquees: number }) {
  if (bloquees) return <span className="sync bad" title="Des saisies ont été refusées par le serveur : prévenez le siège">{bloquees} saisie{bloquees > 1 ? "s" : ""} refusée{bloquees > 1 ? "s" : ""}</span>;
  if (attente) return <span className="sync warn">{enLigne ? "Envoi…" : "Hors ligne"} · {attente} en attente</span>;
  return <span className="sync ok">{enLigne ? "Tout est envoyé" : "Hors ligne"}</span>;
}

/** Minuteurs en cours, visibles sur tous les écrans. Alerte sonore et message au passage des seuils. */
function Bandeau({ minuteurs, retirer }: { minuteurs: Minuteur[]; retirer: (id: string) => void }) {
  const maintenant = useMaintenant(1000);
  const enregistrer = useEnregistrer();
  const toast = useToast();
  const prevenus = useRef(new Set<string>());

  useEffect(() => {
    for (const m of minuteurs) {
      const e = etatMinuteur(m, maintenant);
      if (e !== "encours" && !prevenus.current.has(m.id + e)) {
        prevenus.current.add(m.id + e);
        bip();
        toast(`${m.libelle} : ${e === "depasse" ? "temps dépassé" : "bientôt l'heure limite"}`);
      }
    }
  }, [maintenant, minuteurs, toast]);

  async function terminer(m: Minuteur) {
    if (m.type === "rangement" && m.ref) {
      const ecoule = Date.now() - m.debut;
      await enregistrer({ type: "livraison_rangee", livraison_id: m.ref });
      if (ecoule > m.duree) await enregistrer({ type: "anomalies", lignes: [{
        id: nouvelId(), source: "livraison", ref_id: m.ref, categorie: "Livraison", gravite: "mineure",
        titre: `Livraison rangée en retard (${duree(ecoule)}) · ${String(m.donnees?.fournisseur ?? "")}`,
      }] });
      retirer(m.id);
      toast("Livraison rangée");
    }
  }

  if (!minuteurs.length) return null;
  return (
    <div className="timers">
      {minuteurs.map((m) => {
        const e = etatMinuteur(m, maintenant), ecoule = maintenant - m.debut, reste = m.duree - ecoule;
        return (
          <button key={m.id} className={`tmr ${e === "depasse" ? "bad" : e === "alerte" ? "warn" : ""}`} onClick={() => terminer(m)}>
            <b>{m.libelle}</b>
            <span className="rest num">{reste < 0 ? `Dépassé de ${duree(reste)}` : `Reste ${duree(reste)}`}</span>
            <span className="bar"><i style={{ width: `${Math.min(100, (ecoule / m.duree) * 100)}%` }} /></span>
            <span className="hint" style={{ fontSize: 14 }}>{m.type === "rangement" ? "Touchez quand c'est rangé" : ""}</span>
          </button>
        );
      })}
    </div>
  );
}

let audio: AudioContext | null = null;
function bip() {
  try {
    audio = audio ?? new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.25);
  } catch { /* son indisponible */ }
}
