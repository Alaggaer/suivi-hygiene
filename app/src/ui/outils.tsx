import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { MIN } from "../logique";
export { MIN };
export const hm = (d: number | string) => new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
export function duree(ms: number) {
  const m = Math.max(0, Math.round(Math.abs(ms) / MIN));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}
export const temp = (v: number) => `${v > 0 ? "+" : ""}${String(v).replace(".", ",")} °C`;
export const pct = (v: number) => `${String(v).replace(".", ",")} %`;

/** Heure courante, rafraîchie toutes les `pas` ms. */
export function useMaintenant(pas = 1000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setN(Date.now()), pas); return () => clearInterval(i); }, [pas]);
  return n;
}

/** Déconnexion automatique après `delai` ms sans toucher l'écran. */
export function useInactivite(delai: number, actif: boolean, surExpiration: () => void) {
  const cb = useRef(surExpiration);
  cb.current = surExpiration;
  useEffect(() => {
    if (!actif) return;
    let t = setTimeout(() => cb.current(), delai);
    const relancer = () => { clearTimeout(t); t = setTimeout(() => cb.current(), delai); };
    const evts = ["pointerdown", "keydown"] as const;
    evts.forEach((e) => window.addEventListener(e, relancer));
    return () => { clearTimeout(t); evts.forEach((e) => window.removeEventListener(e, relancer)); };
  }, [delai, actif]);
}

/* ---------- messages furtifs ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number>();
  const afficher = (m: string) => { setMsg(m); window.clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(null), 3200); };
  return (
    <ToastCtx.Provider value={afficher}>
      {children}
      <div id="toast" role="status" className={msg ? "show" : ""}>{msg}</div>
    </ToastCtx.Provider>
  );
}

/* ---------- pavé numérique ---------- */
export function PaveNumerique({ titre, unite, signe, onValider, onFermer }: {
  titre: string; unite: string; signe: boolean; onValider: (v: number) => void; onFermer: () => void;
}) {
  const [v, setV] = useState("");
  const touche = (k: string) => {
    if (k === "del") setV((x) => x.slice(0, -1));
    else if (k === "-") setV((x) => (x.startsWith("-") ? x.slice(1) : "-" + x));
    else if (k === ".") setV((x) => (x.includes(".") ? x : (x === "" || x === "-" ? x + "0" : x) + "."));
    else setV((x) => (x.replace(/[-.]/g, "").length < 4 ? x + k : x));
  };
  const valide = v !== "" && v !== "-" && !Number.isNaN(parseFloat(v));
  return (
    <div id="sheet" className="open" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onFermer()}>
      <div className="pad">
        <h3>{titre}</h3>
        <div className="disp num">{v === "" ? <span style={{ color: "#a9b6c1" }}>—</span> : v.replace(".", ",")} <small style={{ fontSize: 26 }}>{unite}</small></div>
        <div className="keys">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => <button key={k} onClick={() => touche(k)}>{k}</button>)}
          {signe ? <button onClick={() => touche("-")} aria-label="Changer le signe">±</button> : <button onClick={() => touche(".")}>,</button>}
          <button onClick={() => touche("0")}>0</button>
          <button onClick={() => touche("del")} aria-label="Effacer">⌫</button>
          {signe && <button className="k-x" onClick={() => touche(".")}>virgule</button>}
          <button className="k-x" style={{ gridColumn: signe ? "span 2" : "1 / -1" }} onClick={onFermer}>Annuler</button>
          <button className="k-ok" disabled={!valide} onClick={() => onValider(parseFloat(v))}>Valider</button>
        </div>
      </div>
    </div>
  );
}
