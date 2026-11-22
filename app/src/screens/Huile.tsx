import { useEffect, useState } from "react";
import type { EtatFriteuse, Friteuse, SeuilsHuile, Tache } from "../types";
import { nouvelId, useContexte, useEnregistrer } from "../contexte";
import { PaveNumerique, pct, useToast } from "../ui/outils";
import { BORNES_HUILE, etatAvecEnAttente, JOURS_HUILE_MAX, jourHuile, niveauAgeHuile, niveauHuile } from "../logique";
import type { Entree } from "../hors-ligne/stockage";

/** Après chaque mesure, une réponse obligatoire : huile filtrée, huile changée, ou (si elle doit être changée) changement avant le service. */
type Decision = "filtree" | "changee" | "plus-tard";

/**
 * Mesure de l'huile, friteuse par friteuse :
 * - on peut valider avec des friteuses manquantes (elles restent à faire, la tâche reste ouverte) ;
 * - une friteuse éteinte se déclare « non utilisée aujourd'hui » ;
 * - le compteur de jours de la même huile impose un changement au-delà du maximum (14 j par défaut).
 */
export function Huile({ tache, onFini, enAttente = [] }: { tache?: Tache; onFini: () => void; enAttente?: Entree[] }) {
  const toast = useToast();
  const { api } = useContexte();
  const enregistrer = useEnregistrer();
  const [friteuses, setFriteuses] = useState<Friteuse[]>([]);
  const [seuils, setSeuils] = useState<SeuilsHuile>({ orange: 20, rouge: 25 });
  const [etat, setEtat] = useState<Record<string, EtatFriteuse>>({});
  const [vals, setVals] = useState<Record<string, number>>({});
  const [eteinte, setEteinte] = useState<Record<string, boolean>>({});
  const [dec, setDec] = useState<Record<string, Decision>>({});
  const [pave, setPave] = useState<Friteuse | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.friteuses(), api.seuilsHuile(), api.etatFriteuses().catch(() => [] as EtatFriteuse[])])
      .then(([f, s, e]) => {
        setFriteuses(f); setSeuils(s);
        const attente = enAttente.filter((x) => x.statut === "attente").map((x) => x.op);
        setEtat(Object.fromEntries(etatAvecEnAttente(e, attente).map((x) => [x.friteuse_id, x])));
      })
      .catch((e) => setErreur(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const max = seuils.jours_max ?? JOURS_HUILE_MAX;
  const dejaFaite = (f: Friteuse) => !!etat[f.id]?.aujourd_hui_at;
  const aFaire = friteuses.filter((f) => !dejaFaite(f));
  const saisie = (f: Friteuse) => vals[f.id] !== undefined || !!eteinte[f.id];
  /** Raison d'un changement obligatoire, ou null. */
  const obligation = (f: Friteuse): string | null => {
    if (vals[f.id] === undefined) return null;
    if (niveauHuile(vals[f.id], seuils) === "bad") return `${pct(vals[f.id])} de composés polaires`;
    if (niveauAgeHuile(jourHuile(etat[f.id]), max) === "bad") return `huile utilisée depuis ${jourHuile(etat[f.id])} jours (max ${max})`;
    return null;
  };
  const saisies = aFaire.filter(saisie);
  const restantes = aFaire.filter((f) => !saisie(f));
  /** Réponse valable : présente, et pas « filtrée » seule quand le changement est obligatoire. */
  const decisionOk = (f: Friteuse) => !!eteinte[f.id]
    || (!!dec[f.id] && !(obligation(f) && dec[f.id] === "filtree") && !(!obligation(f) && dec[f.id] === "plus-tard"));
  const decisionsOk = saisies.every(decisionOk);
  const possible = saisies.length > 0 && decisionsOk;

  async function valider() {
    setEnvoi(true); setErreur(null);
    try {
      const lignes = saisies.map((f) => eteinte[f.id]
        ? { id: nouvelId(), friteuse_id: f.id, polaires: null, filtrage: false, changement: false, non_utilisee: true }
        : { id: nouvelId(), friteuse_id: f.id, polaires: vals[f.id], filtrage: dec[f.id] === "filtree",
            changement: dec[f.id] === "changee", litres: dec[f.id] === "changee" ? f.litres : undefined });
      // La tâche n'est close que lorsque toutes les friteuses ont été faites aujourd'hui.
      await enregistrer({ type: "huile", tache_id: restantes.length ? undefined : tache?.id, lignes });
      const anomalies = saisies.filter((f) => dec[f.id] === "plus-tard").map((f) => ({
        id: nouvelId(), source: "huile", categorie: "Huile", gravite: "majeure" as const,
        titre: `${f.nom} : ${obligation(f)} · changement à faire avant le service`,
        ref_id: lignes.find((l) => l.friteuse_id === f.id)!.id,
      }));
      if (anomalies.length) await enregistrer({ type: "anomalies", lignes: anomalies });
      toast(restantes.length
        ? `Enregistré · reste à faire : ${restantes.map((f) => f.nom).join(", ")}`
        : "Mesure de l'huile enregistrée");
      onFini();
    } catch (e) { setErreur((e as Error).message); setEnvoi(false); }
  }

  const LIB = { ok: "Bonne", warn: "À changer bientôt", bad: "Interdite · à changer", none: "À mesurer" };
  const libelleBouton = envoi ? "Enregistrement…"
    : !saisies.length ? "Saisissez au moins une friteuse"
    : !decisionsOk ? "Indiquez pour chaque friteuse : filtrée ou changée"
    : restantes.length ? `Valider (${restantes.length} friteuse${restantes.length > 1 ? "s" : ""} restera à faire)`
    : "Valider la mesure";

  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>Mesure de l'huile</h1>
      <p className="hint">Plongez le testeur de polarité dans chaque friteuse et tapez le % affiché. Vous pouvez valider les friteuses au fur et à mesure.</p>
      <div className="rows">
        {friteuses.map((f) => {
          const e = etat[f.id];
          if (dejaFaite(f)) {
            const h = new Date(e!.aujourd_hui_at!).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
            return (
              <div key={f.id} className="row fait">
                <span><span className="n">{f.nom}</span><br /><span className="seuil">Faite à {h}</span></span>
                <span className="pill ok">{e!.aujourd_hui_non_utilisee ? "Non utilisée aujourd'hui" : `${pct(e!.aujourd_hui_polaires ?? 0)} · jour ${Math.max(1, e!.jours_utilisation)}/${max}`}</span>
              </div>
            );
          }
          const off = !!eteinte[f.id];
          const v = vals[f.id], a = v !== undefined, n = a ? niveauHuile(v, seuils) : "none";
          const jour = jourHuile(e), age = niveauAgeHuile(jour, max);
          const oblig = obligation(f);
          const cls = off ? "off" : oblig ? "bad" : (n === "warn" || age !== "ok") ? "warn" : "";
          return (
            <div key={f.id} className={`row ${cls}`}>
              <span>
                <span className="n">{f.nom}</span><br />
                <span className="seuil">
                  {f.litres} L · <b className={age === "bad" ? "txt-bad" : age === "warn" ? "txt-warn" : ""}>huile : jour {jour}/{max}</b>
                  {e && !e.dernier_changement && " (aucun changement enregistré)"}
                </span>
                {!a && (<><br />
                  <button className="lien" onClick={() => setEteinte({ ...eteinte, [f.id]: !off })}>
                    {off ? "Finalement, elle est utilisée" : "Non utilisée aujourd'hui ?"}
                  </button></>
                )}
              </span>
              {off ? <span className="pill none">Non utilisée aujourd'hui</span>
                : a && n !== "bad" && age === "bad" ? <span className="pill bad">Trop vieille · à changer</span>
                : <span className={`pill ${n}`}>{LIB[n]}</span>}
              {!off && <button className={`val num ${a ? "filled" : ""}`} onClick={() => setPave(f)}>{a ? pct(v) : "Saisir"}</button>}
              {a && (
                <div className="fix" style={{ borderTopColor: "var(--line)" }}>
                  {oblig ? <p>Changement obligatoire avant le service : {oblig}.</p>
                    : <p className={decisionOk(f) ? "seuil" : ""}>Réponse obligatoire : huile filtrée ou changée ?</p>}
                  {!oblig && age === "warn" && <p className="info">Dernier{jour === max ? "" : "s"} jour{jour === max ? "" : "s"} pour cette huile : à changer au plus tard après le jour {max}.</p>}
                  {!oblig && <button className={`opt ${dec[f.id] === "filtree" ? "sel" : ""}`} onClick={() => setDec({ ...dec, [f.id]: "filtree" })}>Huile filtrée</button>}
                  <button className={`opt ${dec[f.id] === "changee" ? "sel" : ""}`} onClick={() => setDec({ ...dec, [f.id]: "changee" })}>Huile changée ({f.litres} L)</button>
                  {oblig && <button className={`opt ${dec[f.id] === "plus-tard" ? "sel" : ""}`} onClick={() => setDec({ ...dec, [f.id]: "plus-tard" })}>Je change avant le service</button>}
                  {dec[f.id] === "changee" && <p className="seuil">Nouvelle huile : le compteur repart au jour 1.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {friteuses.length > 0 && !aFaire.length && <p className="pill ok">Toutes les friteuses sont faites pour aujourd'hui.</p>}
      {friteuses.length > 0 && !aFaire.length && tache && !tache.faite_at && (
        <button className="bigbtn" disabled={envoi} onClick={async () => {
          setEnvoi(true);
          try { await enregistrer({ type: "terminer_tache", tache_id: tache.id }); toast("Tâche close"); onFini(); }
          catch (e) { setErreur((e as Error).message); setEnvoi(false); }
        }}>Clore la tâche</button>
      )}
      {erreur && <p className="pill bad">{erreur}</p>}
      {aFaire.length > 0 && <button className="bigbtn" disabled={!possible || envoi} onClick={valider}>{libelleBouton}</button>}
      {pave && <PaveNumerique titre={`${pave.nom} · composés polaires`} unite="%" signe={false} bornes={BORNES_HUILE} onFermer={() => setPave(null)} onValider={(v) => { setVals({ ...vals, [pave.id]: v }); if (v !== vals[pave.id]) { const d = { ...dec }; delete d[pave.id]; setDec(d); } setPave(null); }} />}
    </div>
  );
}
