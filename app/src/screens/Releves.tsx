import { useEffect, useState } from "react";
import type { Enceinte, Tache } from "../types";
import { nouvelId, useContexte, useEnregistrer } from "../contexte";
import { PaveNumerique, temp, useToast } from "../ui/outils";
import { temperatureConforme } from "../logique";

const ACTIONS = ["Thermostat réglé", "Porte mal fermée, refermée", "Denrées déplacées", "Denrées jetées", "Technicien appelé"];

export function Releves({ tache, onFini }: { tache?: Tache; onFini: () => void }) {
  const toast = useToast();
  const { api } = useContexte();
  const enregistrer = useEnregistrer();
  const [enceintes, setEnceintes] = useState<Enceinte[]>([]);
  const [vals, setVals] = useState<Record<string, number>>({});
  const [fix, setFix] = useState<Record<string, string>>({});
  const [pave, setPave] = useState<Enceinte | null>(null);
  const [hs, setHs] = useState<Record<string, boolean>>({});   // enceintes hors service (panne, vidée, inaccessible)
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => { api.enceintes().then(setEnceintes).catch((e) => setErreur(e.message)); }, [api]);

  const horsSeuil = (e: Enceinte) => vals[e.id] !== undefined && !temperatureConforme(vals[e.id], e.t_max);
  const restantes = enceintes.filter((e) => !hs[e.id] && (vals[e.id] === undefined || (horsSeuil(e) && !fix[e.id]))).length;
  const complet = enceintes.length > 0 && restantes === 0;

  async function valider() {
    setEnvoi(true); setErreur(null);
    try {
      const mesurees = enceintes.filter((e) => !hs[e.id]);
      const lignes = mesurees.map((e) => ({ id: nouvelId(), enceinte_id: e.id, valeur: vals[e.id], t_max: e.t_max, action: horsSeuil(e) ? fix[e.id] : undefined }));
      await enregistrer({ type: "releves", tache_id: tache?.id, lignes });
      const anomalies = [
        ...mesurees.filter(horsSeuil).map((e) => ({
          id: nouvelId(), source: "releve", categorie: "Température", gravite: "majeure" as const,
          titre: `${e.nom} à ${temp(vals[e.id])} (max ${temp(e.t_max)}) · ${fix[e.id]}`,
          ref_id: lignes.find((l) => l.enceinte_id === e.id)!.id,
        })),
        ...enceintes.filter((e) => hs[e.id]).map((e) => ({
          id: nouvelId(), source: "releve", categorie: "Matériel", gravite: "majeure" as const,
          titre: `${e.nom} hors service · pas de relevé`, ref_id: e.id,
        })),
      ];
      if (anomalies.length) await enregistrer({ type: "anomalies", lignes: anomalies });
      toast(anomalies.length ? `Relevé enregistré · ${anomalies.length} anomalie(s) créée(s)` : "Relevé enregistré");
      onFini();
    } catch (e) { setErreur((e as Error).message); setEnvoi(false); }
  }

  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>{tache?.titre ?? "Relevé de températures"}</h1>
      <p className="hint">Touchez une case et tapez la température affichée. Hors seuil : choisissez l'action faite, une anomalie est créée.</p>
      <div className="rows">
        {enceintes.map((e) => {
          const v = vals[e.id], a = v !== undefined, ko = horsSeuil(e), panne = !!hs[e.id];
          return (
            <div key={e.id} className={`row ${ko ? "bad" : ""} ${panne ? "warn" : ""}`}>
              <span><span className="n">{e.nom}</span><br /><span className="seuil">Maximum {temp(e.t_max)}</span><br />
                <button className="lien" onClick={() => { setHs({ ...hs, [e.id]: !panne }); if (!panne) { const nv = { ...vals }; delete nv[e.id]; setVals(nv); } }}>
                  {panne ? "Remettre en service" : "Enceinte hors service ?"}
                </button>
              </span>
              <span className={`pill ${panne ? "warn" : a ? (ko ? "bad" : "ok") : "none"}`}>{panne ? "Hors service" : a ? (ko ? "Hors seuil" : "Conforme") : "À relever"}</span>
              {panne
                ? <span className="hint" style={{ maxWidth: 160, fontSize: 14 }}>Une anomalie sera créée</span>
                : <button className={`val num ${a ? "filled" : ""}`} onClick={() => setPave(e)}>{a ? temp(v) : "Saisir"}</button>}
              {ko && !panne && (
                <div className="fix"><p>Action corrective obligatoire</p>
                  {ACTIONS.map((x) => <button key={x} className={`opt ${fix[e.id] === x ? "sel" : ""}`} onClick={() => setFix({ ...fix, [e.id]: x })}>{x}</button>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {erreur && <p className="pill bad">{erreur}</p>}
      <button className="bigbtn" disabled={!complet || envoi} onClick={valider}>
        {envoi ? "Enregistrement…" : restantes ? `Encore ${restantes} enceinte${restantes > 1 ? "s" : ""} à relever` : "Valider le relevé"}
      </button>
      {pave && <PaveNumerique titre={pave.nom} unite="°C" signe onFermer={() => setPave(null)} onValider={(v) => { setVals({ ...vals, [pave.id]: v }); setPave(null); }} />}
    </div>
  );
}
