import { useCallback, useEffect, useState } from "react";
import type { Anomalie, Api, Profil, Site, Tache } from "./types";
import { Accueil, ListeAnomalies } from "./screens/Accueil";
import { Activation, Connexion } from "./screens/Connexion";
import { Releves } from "./screens/Releves";
import { Huile } from "./screens/Huile";
import { hm, MIN, useInactivite, useMaintenant, useToast } from "./ui/outils";

type Ecran = { nom: "accueil" } | { nom: "releves"; tache?: Tache } | { nom: "huile"; tache?: Tache } | { nom: "anomalies" };

export default function App({ api }: { api: Api }) {
  const toast = useToast();
  const [activee, setActivee] = useState<boolean | null>(null);
  const [site, setSite] = useState<Site | null>(null);
  const [profil, setProfil] = useState<Profil | null>(null);
  const [ecran, setEcran] = useState<Ecran>({ nom: "accueil" });
  const [taches, setTaches] = useState<Tache[]>([]);
  const [anomalies, setAnomalies] = useState<Anomalie[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const maintenant = useMaintenant(10_000);

  useEffect(() => { api.estActivee().then(setActivee); }, [api]);
  useEffect(() => { if (activee) api.site().then(setSite).catch((e) => setErreur(e.message)); }, [api, activee]);

  const recharger = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([api.taches(), api.anomaliesOuvertes()]);
      setTaches(t); setAnomalies(a); setErreur(null);
    } catch (e) { setErreur((e as Error).message); }
  }, [api]);

  // Rechargement à la connexion puis toutes les 2 minutes (escalades calculées côté serveur).
  useEffect(() => { if (!profil) return; recharger(); const i = setInterval(recharger, 2 * MIN); return () => clearInterval(i); }, [profil, recharger]);

  // Tablette partagée : retour à l'écran « Qui êtes-vous ? » après 2 minutes sans toucher l'écran.
  useInactivite(2 * MIN, !!profil, () => { setProfil(null); setEcran({ nom: "accueil" }); });

  const retour = () => { setEcran({ nom: "accueil" }); recharger(); };
  const ouvrirTache = (t: Tache) => {
    if (t.type === "releves") setEcran({ nom: "releves", tache: t });
    else if (t.type === "huile") setEcran({ nom: "huile", tache: t });
    else toast("Ce type de tâche arrive dans une prochaine version.");
  };

  let corps;
  if (activee === null) corps = <p className="hint">Chargement…</p>;
  else if (!activee) corps = <Activation api={api} onActivee={() => setActivee(true)} />;
  else if (!profil) corps = <Connexion api={api} onConnecte={(p) => { setProfil(p); toast(`Bonjour ${p.nom}`); }} />;
  else if (ecran.nom === "releves") corps = <Releves api={api} profil={profil} tache={ecran.tache} onFini={retour} />;
  else if (ecran.nom === "huile") corps = <Huile api={api} profil={profil} tache={ecran.tache} onFini={retour} />;
  else if (ecran.nom === "anomalies") corps = <ListeAnomalies anomalies={anomalies} onRetour={retour} />;
  else corps = <Accueil taches={taches} anomalies={anomalies} onTache={ouvrirTache} onAller={(n) => setEcran({ nom: n })} />;

  return (
    <div id="app">
      <div className="top">
        <span className="site">{site ? `${site.nom} · ${site.ville}` : "Suivi Hygiène"}</span>
        {profil && <span className="who">{profil.nom} <button className="chipbtn" onClick={() => { setProfil(null); setEcran({ nom: "accueil" }); }}>Changer d'utilisateur</button></span>}
        <span className="clock num">{hm(maintenant)}</span>
      </div>
      {api.mode === "demo" && <div className="demo">Mode démonstration : serveur simulé, rien n'est conservé. PIN : Karim 1234, Julie 1111, Mehdi 2222, Thomas 3333.</div>}
      {erreur && <div className="demo" style={{ background: "var(--bad-bg)", color: "var(--bad)" }}>{erreur}</div>}
      <main id="main">{corps}</main>
    </div>
  );
}
