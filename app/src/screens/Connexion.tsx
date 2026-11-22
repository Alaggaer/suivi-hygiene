import { useEffect, useState } from "react";
import type { Api, Profil } from "../types";

/** Activation de la tablette (une fois, par le siège) avec le compte du site. */
export function Activation({ api, onActivee }: { api: Api; onActivee: () => void }) {
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  return (
    <form className="login" onSubmit={async (e) => {
      e.preventDefault(); setEnvoi(true); setErreur(null);
      try { await api.activer(email.trim(), mdp); onActivee(); } catch (err) { setErreur((err as Error).message); } finally { setEnvoi(false); }
    }}>
      <h1 style={{ fontSize: 40 }}>Activer la tablette</h1>
      <p className="hint">À faire une seule fois par le siège, avec le compte du restaurant.</p>
      <label className="card" htmlFor="email"><b>Adresse du compte tablette</b>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="champ" required /></label>
      <label className="card" htmlFor="mdp"><b>Mot de passe</b>
        <input id="mdp" type="password" autoComplete="current-password" value={mdp} onChange={(e) => setMdp(e.target.value)} className="champ" required /></label>
      {erreur && <p className="pill bad">{erreur}</p>}
      <button className="bigbtn" disabled={envoi}>{envoi ? "Connexion…" : "Activer"}</button>
    </form>
  );
}

/** Choix de la personne puis code PIN. */
export function Connexion({ api, onConnecte, reprise }: { api: Api; onConnecte: (p: Profil) => void; reprise?: Profil }) {
  const [profils, setProfils] = useState<Profil[]>([]);
  const [choix, setChoix] = useState<Profil | null>(reprise ?? null);
  const [pin, setPin] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => { api.profils().then(setProfils).catch((e) => setErreur(e.message)); }, [api]);

  async function touche(k: string) {
    if (!choix) return;
    if (k === "x") { setChoix(null); setPin(""); return; }
    if (k === "del") { setPin((p) => p.slice(0, -1)); return; }
    const p = pin + k;
    setPin(p);
    if (p.length === 4) {
      try {
        if (await api.verifierPin(choix.id, p)) { onConnecte(choix); return; }
        setErreur("Code incorrect, réessayez.");
      } catch (e) {
        setErreur((e as Error).message || "Vérification impossible, réessayez.");
      }
      setPin("");
    }
  }

  return (
    <div className="login">
      <h1 style={{ fontSize: 40 }}>Qui êtes-vous ?</h1>
      {reprise && <p className="pill warn">Saisie en cours de {reprise.nom}, gardée : retapez votre code pour la reprendre. Une autre personne repart de l'accueil.</p>}
      <div className="users">
        {profils.map((p) => (
          <button key={p.id} className={choix?.id === p.id ? "sel" : ""} onClick={() => { setChoix(p); setPin(""); setErreur(null); }}>
            {p.nom}{p.role !== "equipe" && <><br /><small style={{ fontWeight: 400, color: "var(--muted)" }}>{({ chef: "chef", responsable: "resp. site", siege: "siège" } as Record<string, string>)[p.role]}</small></>}
          </button>
        ))}
      </div>
      {choix && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <b>Code PIN de {choix.nom}</b>
          <div className="dots">{[0, 1, 2, 3].map((i) => <i key={i} className={i < pin.length ? "on" : ""} />)}</div>
          {erreur && <span className="pill bad">{erreur}</span>}
          <div className="keys" style={{ width: "min(360px,100%)" }}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => <button key={k} onClick={() => touche(k)}>{k}</button>)}
            <button onClick={() => touche("del")} aria-label="Effacer">⌫</button>
            <button onClick={() => touche("0")}>0</button>
            <button className="k-x" onClick={() => touche("x")}>Retour</button>
          </div>
        </div>
      )}
      {!choix && erreur && <p className="pill bad">{erreur}</p>}
    </div>
  );
}
