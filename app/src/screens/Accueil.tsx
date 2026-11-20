import type { Anomalie, Tache } from "../types";
import { duree, hm, useMaintenant } from "../ui/outils";
import { etatTache, niveauEscalade, tachesALheure, trierTaches } from "../logique";

const SOUS: Record<string, string> = {
  releves: "Toutes les enceintes", huile: "Chaque friteuse · testeur de polarité", dlc: "Chambres froides et réserve",
  nettoyage: "Fin de service", stock_carte: "Produits sortis de la carte", autre: "",
};

export function Accueil({ taches, anomalies, onTache, onAller }: {
  taches: Tache[]; anomalies: Anomalie[];
  onTache: (t: Tache) => void; onAller: (ecran: "releves" | "huile" | "anomalies") => void;
}) {
  const maintenant = useMaintenant(1000);
  const liste = trierTaches(taches, maintenant);
  const faites = taches.filter((t) => t.faite_at);
  const aLheure = tachesALheure(taches);

  return (
    <div className="home">
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
        <button className="act main" disabled title="Semaine 2"><b>Produit utilisé</b><span>Photo de l'étiquette · bientôt disponible</span></button>
        <button className="act" disabled title="Semaine 2"><b>Livraison</b><span>Bientôt disponible</span></button>
        <button className="act" disabled title="Semaine 3"><b>Minuteur</b><span>Bientôt disponible</span></button>
        <button className="act" onClick={() => onAller("releves")}><b>Températures</b><span>Relevé hors planning</span></button>
        <button className="act" onClick={() => onAller("huile")}><b>Huile</b><span>Mesure, filtrage, changement</span></button>
        <button className="act" onClick={() => onAller("anomalies")} style={{ gridColumn: "1 / -1", minHeight: 90 }}>
          <b>Anomalies du site</b><span>Suivi jusqu'à la clôture</span>
          {anomalies.length > 0 && <span className="badge">{anomalies.length}</span>}
        </button>
      </section>
    </div>
  );
}

export function ListeAnomalies({ anomalies, onRetour }: { anomalies: Anomalie[]; onRetour: () => void }) {
  const maintenant = useMaintenant(30_000);
  return (
    <div className="screen">
      <button className="back" onClick={onRetour}>← Retour</button>
      <h1>Anomalies du site</h1>
      <p className="hint">Le traitement et la vérification arrivent en semaine 3. Pour l'instant : liste des anomalies ouvertes.</p>
      <div className="rows">
        {anomalies.length === 0 && <p className="hint">Aucune anomalie ouverte.</p>}
        {anomalies.map((a) => (
          <div key={a.id} className={`anom g-${a.gravite}`}>
            <span className="stripe" />
            <span><b>{a.titre}</b><br /><span className="hint" style={{ fontSize: 15 }}>{a.categorie} · {a.gravite} · il y a {duree(maintenant - Date.parse(a.cree_at))}</span></span>
            <span className={`pill ${a.statut === "ouverte" ? "bad" : "warn"}`}>{a.statut === "ouverte" ? "Ouverte" : "Traitée"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
