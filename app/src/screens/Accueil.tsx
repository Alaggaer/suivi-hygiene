import type { AlerteProduit, Anomalie, Tache } from "../types";
import { LIBELLE_ALERTE } from "./AlertesProduit";
import { duree, hm, useMaintenant } from "../ui/outils";
import { etatTache, niveauEscalade, tachesALheure, trierTaches } from "../logique";

const SOUS: Record<string, string> = {
  releves: "Toutes les enceintes", huile: "Chaque friteuse · testeur de polarité", dlc: "Chambres froides et réserve",
  nettoyage: "Fin de service", stock_carte: "Produits sortis de la carte", autre: "",
};

export function Accueil({ taches, anomalies, stocksAFaire = 0, alertes = [], onTache, onAller }: {
  taches: Tache[]; anomalies: Anomalie[]; stocksAFaire?: number; alertes?: AlerteProduit[];
  onTache: (t: Tache) => void; onAller: (ecran: "releves" | "huile" | "anomalies" | "stocks" | "alertes" | "livraison" | "produit" | "minuteur" | "signaler") => void;
}) {
  const maintenant = useMaintenant(1000);
  const liste = trierTaches(taches, maintenant);
  const faites = taches.filter((t) => t.faite_at);
  const aLheure = tachesALheure(taches);

  return (
    <div className="home">
      {alertes.filter((a) => !a.reponses.length).map((a) => (
        <button key={a.id} className={`al-bandeau ${a.type}`} onClick={() => onAller("alertes")}>
          <b>{LIBELLE_ALERTE[a.type]} : {a.produit}</b>
          <span>{a.type === "retrait" ? "Vérifiez si vous en avez" : "Vérifiez et réétiquetez"} · avant {hm(a.echeance)}</span>
        </button>
      ))}
      <section className="panel">
        <h2>À faire aujourd'hui <small>{taches.length - faites.length} restantes</small></h2>
        <div className="tasks">
          {liste.length === 0 && <p className="hint">Aucune tâche prévue aujourd'hui. Le siège paramètre les tâches de chaque restaurant.</p>}
          {liste.map((t) => {
            const e = etatTache(t, maintenant), d = Date.parse(t.echeance) - maintenant;
            const retard = -d;
            return (
              <button key={t.id} className={`task ${e}`} disabled={e === "faite"} onClick={() => onTache(t)}>
                <span className="stripe" />
                <span>
                  <span className="t">{t.titre}</span><br /><span className="s">{SOUS[t.type]}</span>
                  {e === "retard" && <><br /><span className="esc">{{ responsable: "Responsable de site prévenu", chef: "Chef prévenu", aucune: "À faire maintenant" }[niveauEscalade(retard)]}</span></>}
                </span>
                <span className="when">
                  {e === "faite" && <><b>Faite</b>{hm(t.faite_at!)}{Date.parse(t.faite_at!) > Date.parse(t.echeance) && ` · +${duree(Date.parse(t.faite_at!) - Date.parse(t.echeance))}`} · {t.faite_par_nom}</>}
                  {e === "retard" && <><b className="num">+{duree(d)}</b>en retard · prévu {hm(t.echeance)}</>}
                  {e === "bientot" && <><b className="num">{duree(d)}</b>restantes · avant {hm(t.echeance)}</>}
                  {e === "avenir" && <><b className="num">{hm(t.echeance)}</b>dans {duree(d)}</>}
                </span>
              </button>
            );
          })}
        </div>
        <p className="kpi">Aujourd'hui : <b>{aLheure} tâche{aLheure > 1 ? "s" : ""} faite{aLheure > 1 ? "s" : ""} à l'heure</b> sur {taches.length} · indicateur suivi par le siège</p>
      </section>
      <section className="actions">
        <button className="act main" onClick={() => onAller("produit")}><b>Traçabilité produits</b><span>Photo de l'étiquette, puis la famille</span></button>
        <button className="act" onClick={() => onAller("livraison")}><b>Livraison</b><span>Températures, BL, conformité</span></button>
        <button className="act" onClick={() => onAller("minuteur")}><b>Minuteur</b><span>Refroidissement, remise en T°</span></button>
        <button className="act" onClick={() => onAller("releves")}><b>Températures</b><span>Relevé hors planning</span></button>
        <button className="act" onClick={() => onAller("huile")}><b>Huile</b><span>Mesure, filtrage, changement</span></button>
        <button className="act alert" onClick={() => onAller("signaler")}><b>Signaler</b><span>Un problème, une photo</span></button>
        {alertes.length > 0 && (
          <button className="act" onClick={() => onAller("alertes")}>
            <b>Alertes produit</b><span>Retraits, prolongations DDM</span>
            {alertes.some((a) => !a.reponses.length) && <span className="badge">{alertes.filter((a) => !a.reponses.length).length}</span>}
          </button>
        )}
        <button className="act" onClick={() => onAller("stocks")}>
          <b>Stocks morts</b><span>Produits sortis de la carte</span>
          {stocksAFaire > 0 && <span className="badge">{stocksAFaire}</span>}
        </button>
        <button className="act" onClick={() => onAller("anomalies")}>
          <b>Anomalies du site</b><span>Suivi jusqu'à la clôture</span>
          {anomalies.length > 0 && <span className="badge">{anomalies.length}</span>}
        </button>
      </section>
    </div>
  );
}
