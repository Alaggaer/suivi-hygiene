import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Anomalie, Api, Profil, Site, Tache, AlerteProduit } from "./types";
import type { FileEnvoi } from "./hors-ligne/file";
import type { Entree } from "./hors-ligne/stockage";
import { ContexteProvider, nouvelId, useEnregistrer, useFile } from "./contexte";
import { etatMinuteur, useMinuteurs, type Minuteur } from "./minuteurs";
import { Accueil } from "./screens/Accueil";
import { Anomalies, FeuilleNonConforme, LancerMinuteur, Signaler, TacheSimple } from "./screens/Semaine3";
import { Activation, Connexion } from "./screens/Connexion";
import { Releves } from "./screens/Releves";
import { TableauSiege } from "./screens/Siege";
import { Huile } from "./screens/Huile";
import { Livraison } from "./screens/Livraison";
import { StocksMorts } from "./screens/StocksMorts";
import { AlertesProduit, avecEnAttente } from "./screens/AlertesProduit";
import { Nettoyage, ProduitsEntretien } from "./screens/Nettoyage";
import { EspacePms } from "./screens/EspacePms";
import { prechargerFiches } from "./fiches";
import { Produit } from "./screens/Produit";
import { duree, hm, MIN, PaveNumerique, temp, useInactivite, useMaintenant, useToast } from "./ui/outils";
import { minuteurConforme } from "./logique";

type Ecran =
  | { nom: "accueil" } | { nom: "releves"; tache?: Tache } | { nom: "huile"; tache?: Tache }
  | { nom: "anomalies" } | { nom: "stocks" } | { nom: "alertes" } | { nom: "produits_entretien" } | { nom: "pms" } | { nom: "nettoyage"; tache: Tache } | { nom: "livraison" } | { nom: "produit" } | { nom: "minuteur" }
  | { nom: "signaler"; categorie?: string } | { nom: "tache"; tache: Tache };

/** Les saisies pas encore envoyées s'affichent tout de suite : tâche cochée, anomalie listée. */
export function appliquerEnAttente(taches: Tache[], anomalies: Anomalie[], entrees: Entree[]) {
  const faites = new Map<string, { at: string; nom: string }>();
  const nouvelles: Anomalie[] = [];
  const statuts = new Map<string, Anomalie["statut"]>();
  // Seulement ce qui attend d'être envoyé : une saisie refusée par le serveur ne doit pas paraître enregistrée.
  for (const { op } of entrees.filter((e) => e.statut === "attente")) {
    if (op.type === "anomalie_statut") statuts.set(op.anomalie_id, op.statut);
    if ((op.type === "terminer_tache" || op.type === "releves" || op.type === "huile") && op.tache_id) faites.set(op.tache_id, { at: op.at_client, nom: op.par_nom });
    if (op.type === "anomalies") op.lignes.forEach((l) => nouvelles.push({ id: l.id, titre: l.titre, categorie: l.categorie, gravite: l.gravite, statut: "ouverte", cree_at: op.at_client, enAttente: true }));
  }
  const ids = new Set(anomalies.map((a) => a.id));
  return {
    taches: taches.map((t) => (!t.faite_at && faites.has(t.id) ? { ...t, faite_at: faites.get(t.id)!.at, faite_par_nom: faites.get(t.id)!.nom } : t)),
    anomalies: [...nouvelles.filter((a) => !ids.has(a.id)).reverse(), ...anomalies]
      .map((a) => (statuts.has(a.id) ? { ...a, statut: statuts.get(a.id)!, enAttente: true } : a))
      .filter((a) => a.statut !== "verifiee"),
  };
}

export default function App({ api, file }: { api: Api; file: FileEnvoi }) {
  const toast = useToast();
  const [activee, setActivee] = useState<boolean | null>(null);
  const [siege, setSiege] = useState(false);
  const [site, setSite] = useState<Site | null>(null);
  const [profil, setProfil] = useState<Profil | null>(null);
  const [enVeille, setEnVeille] = useState(false);   // saisie en cours mise de côté après inactivité
  const [ecran, setEcran] = useState<Ecran>({ nom: "accueil" });
  const [tachesServeur, setTaches] = useState<Tache[]>([]);
  const [anomaliesServeur, setAnomalies] = useState<Anomalie[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enLigne, setEnLigne] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const { etat: etatFile, entrees } = useFile(file);
  const minuteurs = useMinuteurs();
  const [voirRefusees, setVoirRefusees] = useState(false);
  const [stocksAFaireServeur, setStocksAFaire] = useState<string[]>([]);
  const [alertesServeur, setAlertes] = useState<AlerteProduit[]>([]);
  // Au démarrage (souvent après une mise à jour qui corrige la cause), les saisies refusées sont retentées une fois.
  const retente = useRef(false);
  useEffect(() => {
    if (retente.current || !entrees.length) return;
    retente.current = true;
    entrees.filter((e) => e.statut === "bloquee").forEach((e) => file.relancer(e.cle));
  }, [entrees, file]);
  const maintenant = useMaintenant(10_000);

  useEffect(() => { api.estActivee().then(setActivee); }, [api]);
  useEffect(() => {
    if (!activee) return;
    api.estSiege().then((s) => {
      setSiege(s);
      if (!s) api.site().then(setSite).catch((e) => setErreur(e.message));
    });
  }, [api, activee]);

  // Envoi de la file : au démarrage, au retour du réseau, et toutes les 30 s.
  useEffect(() => {
    const relancer = () => { setEnLigne(navigator.onLine); file.vider().catch(() => {}); };
    const horsLigne = () => setEnLigne(false);
    window.addEventListener("online", relancer);
    window.addEventListener("offline", horsLigne);
    file.vider().catch(() => {});
    const i = setInterval(() => { file.vider().catch(() => {}); }, 30_000);
    return () => { window.removeEventListener("online", relancer); window.removeEventListener("offline", horsLigne); clearInterval(i); };
  }, [file]);

  const recharger = useCallback(async () => {
    try {
      // Chaque liste séparément : sans réseau, les anomalies gardées restent visibles même si les tâches du jour ne le sont pas.
      const [t, a] = await Promise.allSettled([api.taches(), api.anomaliesOuvertes()]);
      if (a.status === "fulfilled") setAnomalies(a.value);
      if (t.status === "fulfilled") { setTaches(t.value); setErreur(null); }
      else setErreur(navigator.onLine ? (t.reason as Error).message
        : "Hors ligne : la liste des tâches du jour n'a pas encore pu être chargée aujourd'hui. Les saisies restent possibles et partiront au retour du réseau.");
      api.alertesDuSite().then(setAlertes).catch(() => {});
      api.nettoyageDuJour().catch(() => {});   // gardé pour l'ouvrir hors ligne
      api.produitsEntretien().then((l) => prechargerFiches(api, l.flatMap((p) => [p.ft, p.fds]).filter((x): x is string => !!x))).catch(() => {});
      api.stocksMortsDuSite().then((s) => setStocksAFaire(s.filter((x) => x.a_faire).map((x) => x.produit_id))).catch(() => {});
      // Documents du PMS gardés sur la tablette : lisibles pendant un contrôle même sans réseau.
      if (site) api.documentsSite(site.id).then((c) => prechargerFiches(api, c.documents.map((d) => d.fichier))).catch(() => {});
    } catch (e) { setErreur((e as Error).message); }
  }, [api, site]);

  // Rechargement à la connexion, après chaque envoi réussi, et toutes les 2 minutes.
  useEffect(() => { if (!profil) return; recharger(); const i = setInterval(recharger, 2 * MIN); return () => clearInterval(i); }, [profil, recharger]);
  const attentePrec = useRef(etatFile.attente);
  useEffect(() => { if (profil && etatFile.attente < attentePrec.current) recharger(); attentePrec.current = etatFile.attente; }, [etatFile.attente, profil, recharger]);

  // Tablette partagée : retour à « Qui êtes-vous ? » après 2 minutes sans toucher l'écran.
  // Si une saisie est en cours, elle est gardée (cachée) jusqu'au retour de la même personne.
  useInactivite(2 * MIN, !!profil && !enVeille, () => {
    if (ecran.nom === "accueil") { setProfil(null); return; }
    setEnVeille(true);
  });
  // Veille trop longue (personne n'est revenu) : la saisie cachée est abandonnée, retour à « Qui êtes-vous ? ».
  useEffect(() => {
    if (!enVeille) return;
    const id = setTimeout(() => { setEnVeille(false); setProfil(null); setEcran({ nom: "accueil" }); }, 30 * MIN);
    return () => clearTimeout(id);
  }, [enVeille]);
  const reprendre = (p: Profil) => {
    setEnVeille(false);
    if (p.id !== profil?.id) { setProfil(p); setEcran({ nom: "accueil" }); toast(`Bonjour ${p.nom}`); }
  };

  const { taches, anomalies } = useMemo(() => appliquerEnAttente(tachesServeur, anomaliesServeur, entrees), [tachesServeur, anomaliesServeur, entrees]);

  // Badge « Stocks morts » : produits à vérifier, moins ceux dont la réponse attend encore d'être envoyée.
  const stocksAFaire = stocksAFaireServeur.filter((id) => !entrees.some((e) => e.statut === "attente" && e.op.type === "stock_mort" && e.op.produit_id === id)).length;
  const alertes = useMemo(() => avecEnAttente(alertesServeur, entrees), [alertesServeur, entrees]);
  const retour = () => { setEcran({ nom: "accueil" }); recharger(); };
  const ouvrirTache = (t: Tache) => {
    if (t.type === "releves") setEcran({ nom: "releves", tache: t });
    else if (t.type === "nettoyage" && t.titre.startsWith("Nettoyage ") && !t.faite_at) setEcran({ nom: "nettoyage", tache: t });
    else if (t.type === "huile") setEcran({ nom: "huile", tache: t });
    else setEcran({ nom: "tache", tache: t });
  };

  let corps;
  if (activee === null) corps = <p className="hint">Chargement…</p>;
  else if (!activee) corps = <Activation api={api} onActivee={() => setActivee(true)} />;
  else if (siege) corps = <TableauSiege api={api} />;
  else if (!site) corps = <p className="hint">{erreur ?? "Chargement du restaurant…"}</p>;
  else if (!profil) corps = <Connexion api={api} onConnecte={(p) => { setProfil(p); toast(`Bonjour ${p.nom}`); }} />;
  else if (ecran.nom === "releves") corps = <Releves tache={ecran.tache} onFini={retour} />;
  else if (ecran.nom === "huile") corps = <Huile tache={ecran.tache} onFini={retour} enAttente={entrees} />;
  else if (ecran.nom === "livraison") corps = <Livraison onFini={retour} enAttente={entrees} />;
  else if (ecran.nom === "produit") corps = <Produit onFini={retour} />;
  else if (ecran.nom === "anomalies") corps = <Anomalies anomalies={anomalies} onRetour={retour} />;
  else if (ecran.nom === "minuteur") corps = <LancerMinuteur onFini={retour} lancer={minuteurs.ajouter} />;
  else if (ecran.nom === "signaler") corps = <Signaler onFini={retour} categorie={ecran.categorie} />;
  else if (ecran.nom === "tache") corps = <TacheSimple tache={ecran.tache} onFini={retour} onProbleme={() => setEcran({ nom: "signaler", categorie: "Propreté" })} />;
  else if (ecran.nom === "nettoyage") corps = <Nettoyage tache={ecran.tache} enAttente={entrees} onFini={retour} onProduits={() => setEcran({ nom: "produits_entretien" })} />;
  else if (ecran.nom === "pms") corps = <EspacePms onFini={retour} />;
  else if (ecran.nom === "produits_entretien") corps = <ProduitsEntretien onFini={retour} />;
  else if (ecran.nom === "alertes") corps = <AlertesProduit onFini={retour} enAttente={entrees} />;
  else if (ecran.nom === "stocks") corps = <StocksMorts onFini={retour} enAttente={entrees} />;
  else corps = <Accueil taches={taches} anomalies={anomalies} stocksAFaire={stocksAFaire} alertes={alertes} onTache={ouvrirTache} onAller={(n) => setEcran({ nom: n })} />;

  const contenu = (
    <div id="app">
      <div className="top">
        <span className="site">{siege ? "Siège · Suivi Hygiène" : site ? `${site.nom} · ${site.ville}` : "Suivi Hygiène"}</span>
        {profil && !enVeille && <span className="who">{profil.nom} <button className="chipbtn" onClick={() => { setProfil(null); setEnVeille(false); setEcran({ nom: "accueil" }); }}>Changer d'utilisateur</button></span>}
        {!siege && <Synchro enLigne={enLigne} attente={etatFile.attente} bloquees={etatFile.bloquees} onVoir={() => { if (!enVeille) setVoirRefusees(true); }} />}
        <span className="clock num">{hm(maintenant)}</span>
      </div>
      {api.mode === "demo" && (
        <div className="demo">
          {siege
            ? <>Vue siège · chiffres d'exemple. <a href="#tablette" onClick={() => { location.hash = "tablette"; location.reload(); }}>Revenir à la tablette</a></>
            : <>Mode démonstration : serveur simulé, rien n'est conservé. PIN : Karim 1234, Julie 1111, Mehdi 2222, Thomas 3333. <a href="#siege" onClick={() => { location.hash = "siege"; location.reload(); }}>Voir le tableau du siège</a></>}
        </div>
      )}
      {erreur && profil && <div className="demo" style={{ background: "var(--bad-bg)", color: "var(--bad)" }}>{erreur}</div>}
      {profil && <Bandeau minuteurs={minuteurs.liste} retirer={minuteurs.retirer} />}
      <main id="main">
        {/* Même position dans l'arbre, veille ou non : la saisie cachée garde son état. */}
        <div style={{ display: enVeille ? "none" : "contents" }}>{corps}</div>
        {enVeille && profil && <Connexion api={api} reprise={profil} onConnecte={reprendre} />}
      </main>
      {voirRefusees && <SaisiesRefusees entrees={entrees.filter((e) => e.statut === "bloquee")} onRelancer={(cle) => file.relancer(cle)}
        onAbandonner={(cle) => file.abandonner(cle)} peutAbandonner={!!profil && !enVeille && profil.role !== "equipe"} onFermer={() => setVoirRefusees(false)} />}
    </div>
  );
  return site && profil ? <ContexteProvider valeur={{ api, file, site, profil }}>{contenu}</ContexteProvider> : contenu;
}

function Synchro({ enLigne, attente, bloquees, onVoir }: { enLigne: boolean; attente: number; bloquees: number; onVoir: () => void }) {
  if (bloquees) return <button className="sync bad" onClick={onVoir}>{bloquees} saisie{bloquees > 1 ? "s" : ""} refusée{bloquees > 1 ? "s" : ""} · voir</button>;
  if (attente) return <span className="sync warn">{enLigne ? "Envoi…" : "Hors ligne"} · {attente} en attente</span>;
  return <span className="sync ok">{enLigne ? "Tout est envoyé" : "Hors ligne"}</span>;
}

/** Minuteurs en cours, visibles sur tous les écrans. Alerte sonore et message au passage des seuils. */
function Bandeau({ minuteurs, retirer }: { minuteurs: Minuteur[]; retirer: (id: string) => void }) {
  const maintenant = useMaintenant(1000);
  const enregistrer = useEnregistrer();
  const toast = useToast();
  const prevenus = useRef(new Set<string>());
  const [saisie, setSaisie] = useState<Minuteur | null>(null);
  const [nc, setNc] = useState<{ m: Minuteur; tFin: number; ecoule: number } | null>(null);

  async function enregistrerMinuteur(m: Minuteur, tFin: number, ecoule: number, conforme: boolean, action?: string) {
    const id = nouvelId();
    const plat = String(m.donnees?.plat ?? ""), tDebut = Number(m.donnees?.t_debut ?? 0);
    const type = m.type as "refroidissement" | "remise_temperature";
    await enregistrer({ type: "minuteur", id, type_minuteur: type, plat, t_debut: tDebut,
      debut_at: new Date(m.debut).toISOString(), t_fin: tFin, fin_at: new Date().toISOString(), conforme, action });
    if (!conforme) await enregistrer({ type: "anomalies", lignes: [{
      id: nouvelId(), source: "minuteur", ref_id: id, categorie: "Process", gravite: "critique",
      titre: `${type === "refroidissement" ? "Refroidissement raté" : "Remise en T° ratée"} · ${plat} (${temp(tFin)} après ${duree(ecoule)}) · ${action}`,
    }] });
    retirer(m.id);
    toast(conforme ? `Conforme · ${temp(tFin)} en ${duree(ecoule)}` : "Non conforme : anomalie critique envoyée au siège");
  }

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
    if (m.type !== "rangement") { setSaisie(m); return; }
    retirer(m.id);   // ancien chrono de rangement (plus suivi)
  }

  if (!minuteurs.length) return null;
  return (
    <div className="timers">
      {saisie && <PaveNumerique titre={`Température à cœur · ${String(saisie.donnees?.plat ?? "")}`} unite="°C" signe={false}
        onFermer={() => setSaisie(null)}
        onValider={(v) => {
          const m = saisie, ecoule = Date.now() - m.debut;
          setSaisie(null);
          if (minuteurConforme(m.type as "refroidissement" | "remise_temperature", v, ecoule)) void enregistrerMinuteur(m, v, ecoule, true);
          else setNc({ m, tFin: v, ecoule });
        }} />}
      {nc && <FeuilleNonConforme m={nc.m} tFin={nc.tFin} ecoule={nc.ecoule} onFermer={() => setNc(null)}
        onChoix={(a) => { const x = nc; setNc(null); void enregistrerMinuteur(x.m, x.tFin, x.ecoule, false, a); }} />}
      {minuteurs.map((m) => {
        const e = etatMinuteur(m, maintenant), ecoule = maintenant - m.debut, reste = m.duree - ecoule;
        return (
          <button key={m.id} className={`tmr ${e === "depasse" ? "bad" : e === "alerte" ? "warn" : ""}`} onClick={() => terminer(m)}>
            <b>{m.libelle}</b>
            <span className="rest num">{reste < 0 ? `Dépassé de ${duree(reste)}` : `Reste ${duree(reste)}`}</span>
            <span className="bar"><i style={{ width: `${Math.min(100, (ecoule / m.duree) * 100)}%` }} /></span>
            <span className="hint" style={{ fontSize: 14 }}>{m.type === "rangement" ? "Touchez quand c'est rangé" : e === "encours" ? `Objectif : ${m.type === "refroidissement" ? "sous +10 °C" : "+63 °C ou plus"}` : "Prendre la température"}</span>
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

const LIBELLE_OP: Record<string, string> = {
  releves: "Relevé de températures", huile: "Mesure de l'huile", anomalies: "Signalement d'anomalie", terminer_tache: "Tâche terminée",
  livraison: "Réception de livraison", livraison_rangee: "Livraison rangée", utilisation: "Traçabilité produit",
  minuteur: "Refroidissement / remise en température", anomalie_statut: "Suivi d'anomalie",
  stock_mort: "Vérification de stock mort", reponse_alerte: "Réponse à une alerte produit", nettoyage_fait: "Élément de nettoyage",
  controle_fait: "Contrôle PMS", verification_mesure: "Vérification de sonde", action_planifiee: "Action prévue",
  visite: "Visite ou audit", analyses: "Résultats d'analyses", document_pms: "Document du PMS", document_archive: "Retrait d'un document",
};

/** Saisies que le serveur a refusées : ce que c'était, quand, pourquoi, et un bouton pour réessayer. */
function SaisiesRefusees({ entrees, onRelancer, onAbandonner, peutAbandonner, onFermer }: {
  entrees: Entree[]; onRelancer: (cle: number) => void; onAbandonner: (cle: number) => void; peutAbandonner: boolean; onFermer: () => void;
}) {
  const [aAbandonner, setAAbandonner] = useState<number | null>(null);
  return (
    <div id="sheet" className="open" role="dialog" aria-modal="true" aria-label="Saisies refusées" onClick={(e) => e.target === e.currentTarget && onFermer()}>
      <div className="pad refusees">
        <h3>Saisies refusées par le serveur</h3>
        <p className="hint">Elles sont gardées sur la tablette et n'ont pas été enregistrées. Réessayez ; si le refus continue, prévenez le siège avec le motif affiché. Le chef ou le responsable peut abandonner une saisie qui ne passera jamais (à refaire correctement).</p>
        {!entrees.length && <p className="pill ok">Plus aucune saisie refusée.</p>}
        {entrees.map((e) => (
          <div key={e.cle} className="refusee">
            <div><b>{LIBELLE_OP[e.op.type] ?? e.op.type}</b> · <span className="hint">{new Date(e.op.at_client).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
            <div className="hint">Motif : {e.erreur ?? "inconnu"}</div>
            <div className="opts">
              <button className="opt" onClick={() => onRelancer(e.cle)}>Réessayer</button>
              {peutAbandonner && (aAbandonner === e.cle
                ? <><button className="opt sel bad" onClick={() => { setAAbandonner(null); onAbandonner(e.cle); }}>Confirmer : ne jamais l'envoyer</button><button className="lien" onClick={() => setAAbandonner(null)}>annuler</button></>
                : <button className="lien" onClick={() => setAAbandonner(e.cle)}>Abandonner</button>)}
            </div>
          </div>
        ))}
        <button className="bigbtn" onClick={onFermer}>Fermer</button>
      </div>
    </div>
  );
}
