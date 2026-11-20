import { useEffect, useState } from "react";
import type { Api, Friteuse, NouvelleAnomalie, Profil, SeuilsHuile, Tache } from "../types";
import { PaveNumerique, pct, useToast } from "../ui/outils";
import { niveauHuile } from "../logique";

type Changement = "fait" | "plus-tard";

export function Huile({ api, profil, tache, onFini }: { api: Api; profil: Profil; tache?: Tache; onFini: () => void }) {
  const toast = useToast();
  const [friteuses, setFriteuses] = useState<Friteuse[]>([]);
  const [seuils, setSeuils] = useState<SeuilsHuile>({ orange: 20, rouge: 25 });
  const [vals, setVals] = useState<Record<string, number>>({});
  const [filtrage, setFiltrage] = useState<Record<string, boolean>>({});
  const [chg, setChg] = useState<Record<string, Changement>>({});
  const [pave, setPave] = useState<Friteuse | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.friteuses(), api.seuilsHuile()]).then(([f, s]) => { setFriteuses(f); setSeuils(s); }).catch((e) => setErreur(e.message));
  }, [api]);

  const niveau = (v: number) => niveauHuile(v, seuils);
  const complet = friteuses.length > 0 && friteuses.every((f) => vals[f.id] !== undefined && (niveau(vals[f.id]) !== "bad" || chg[f.id]));

  async function valider() {
    setEnvoi(true); setErreur(null);
    try {
      await api.enregistrerHuile(profil, friteuses.map((f) => ({
        friteuse_id: f.id, polaires: vals[f.id], filtrage: !!filtrage[f.id],
        changement: chg[f.id] === "fait", litres: chg[f.id] === "fait" ? f.litres : undefined,
      })), tache?.id);
      const anomalies: NouvelleAnomalie[] = friteuses.filter((f) => chg[f.id] === "plus-tard").map((f) => ({
        source: "huile", categorie: "Huile", gravite: "majeure",
        titre: `${f.nom} à ${pct(vals[f.id])} de composés polaires · changement à faire avant le service`,
      }));
      await api.creerAnomalies(profil, anomalies);
      toast("Mesure de l'huile enregistrée");
      onFini();
    } catch (e) { setErreur((e as Error).message); setEnvoi(false); }
  }

  const LIB = { ok: "Bonne", warn: "À changer bientôt", bad: "Interdite · à changer", none: "À mesurer" };
  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>Mesure de l'huile</h1>
      <p className="hint">Plongez le testeur de polarité dans chaque friteuse et tapez le % de composés polaires affiché.</p>
      <div className="rows">
        {friteuses.map((f) => {
          const v = vals[f.id], a = v !== undefined, n = a ? niveau(v) : "none";
          return (
            <div key={f.id} className={`row ${n === "bad" ? "bad" : n === "warn" ? "warn" : ""}`}>
              <span><span className="n">{f.nom}</span><br /><span className="seuil">{f.litres} L · vert sous {seuils.orange} %, interdit à {seuils.rouge} %</span></span>
              <span className={`pill ${n}`}>{LIB[n]}</span>
              <button className={`val num ${a ? "filled" : ""}`} onClick={() => setPave(f)}>{a ? pct(v) : "Saisir"}</button>
              {a && (
                <div className="fix" style={{ borderTopColor: "var(--line)" }}>
                  {n === "bad" && <p>Huile impropre à la consommation : changement obligatoire avant le service.</p>}
                  <button className={`opt ${filtrage[f.id] ? "sel" : ""}`} onClick={() => setFiltrage({ ...filtrage, [f.id]: !filtrage[f.id] })}>Filtrage fait</button>
                  <button className={`opt ${chg[f.id] === "fait" ? "sel" : ""}`} onClick={() => setChg({ ...chg, [f.id]: "fait" })}>Huile changée ({f.litres} L)</button>
                  {n === "bad" && <button className={`opt ${chg[f.id] === "plus-tard" ? "sel" : ""}`} onClick={() => setChg({ ...chg, [f.id]: "plus-tard" })}>Je change avant le service</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {erreur && <p className="pill bad">{erreur}</p>}
      <button className="bigbtn" disabled={!complet || envoi} onClick={valider}>{envoi ? "Enregistrement…" : "Valider la mesure"}</button>
      {pave && <PaveNumerique titre={`${pave.nom} · composés polaires`} unite="%" signe={false} onFermer={() => setPave(null)} onValider={(v) => { setVals({ ...vals, [pave.id]: v }); setPave(null); }} />}
    </div>
  );
}
