import { useEffect, useState } from "react";
import type { ActionPlan, AppareilMesure, ControleSite, MethodeMesure, Profil, RubriqueControle } from "../types";
import { nouvelId, useContexte, useEnregistrer } from "../contexte";
import { actionEnRetard, cheminPhoto, ETAT_CONTROLE, lectureConforme, transitionPermise } from "../logique";
import { ChampPhoto } from "../ui/Photo";
import { useToast } from "../ui/outils";
import { useDocument } from "./AlertesProduit";

type Section = "actions" | RubriqueControle | "sondes";
const auj = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const date = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const PERIODE: Record<number, string> = { 1: "chaque mois", 2: "tous les 2 mois", 3: "tous les 3 mois", 6: "tous les 6 mois", 12: "chaque année", 24: "tous les 2 ans" };
const Etat = ({ e }: { e: string }) => <span className={`pill ${ETAT_CONTROLE[e]?.classe ?? "none"}`}>{ETAT_CONTROLE[e]?.libelle ?? e}</span>;

/**
 * Espace PMS de la tablette, réservé au chef et au responsable de site :
 * plan d'action, entretien technique, nuisibles (3D), sondes et thermomètres.
 */
export function EspacePms({ onFini }: { onFini: () => void }) {
  const { api, site, profil } = useContexte();
  const [section, setSection] = useState<Section | null>(null);
  const [actions, setActions] = useState<ActionPlan[] | null>(null);
  const [controles, setControles] = useState<ControleSite[] | null>(null);
  const [sondes, setSondes] = useState<AppareilMesure[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = () => Promise.all([api.planAction(site.id).then(setActions), api.etatControles(site.id).then(setControles), api.etatMetrologie(site.id).then(setSondes)])
    .catch(() => setErreur("Espace PMS indisponible sans réseau. Reconnectez la tablette puis réessayez."));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (profil.role !== "equipe") charger(); }, [api, site.id]);

  if (profil.role === "equipe") return (
    <div className="screen"><button className="back" onClick={onFini}>← Retour</button><h1>Espace PMS</h1>
      <p className="pill warn">Réservé au chef et au responsable de site. Connectez-vous avec votre code.</p></div>
  );
  // Au retour, relire ; et relire encore un peu après, le temps que les saisies faites à l'instant arrivent au serveur.
  const retour = () => { setSection(null); charger(); window.setTimeout(charger, 2500); };
  if (section === "actions" && actions) return <PlanAction actions={actions} setActions={setActions} onRetour={retour} />;
  if ((section === "entretien" || section === "nuisibles") && controles) return <Controles rubrique={section} controles={controles} setControles={setControles} onRetour={retour} />;
  if (section === "sondes" && sondes) return <Sondes sondes={sondes} setSondes={setSondes} onRetour={retour} recharger={charger} />;

  const a = auj();
  const ouvertes = actions?.filter((x) => x.statut !== "verifiee") ?? [];
  const aFaire = (r: RubriqueControle) => controles?.filter((c) => c.rubrique === r && (c.etat === "retard" || c.etat === "jamais")).length ?? 0;
  const tuiles: { s: Section; titre: string; sous: string; alerte: number }[] = [
    { s: "actions", titre: "Plan d'action", sous: actions ? `${ouvertes.length} en cours · ${ouvertes.filter((x) => actionEnRetard(x, a)).length} en retard` : "…",
      alerte: ouvertes.filter((x) => actionEnRetard(x, a) || (x.statut === "ouverte" && !x.echeance)).length },
    { s: "entretien", titre: "Entretien technique", sous: "Condenseurs, hotte, joints, sols, siphons", alerte: aFaire("entretien") },
    { s: "nuisibles", titre: "Nuisibles (3D)", sous: "Prestataire, appâts, moustiquaires, bas de portes", alerte: aFaire("nuisibles") },
    { s: "sondes", titre: "Sondes et thermomètres", sous: "Vérification annuelle", alerte: sondes?.filter((x) => x.etat !== "a_jour" && x.etat !== "bientot").length ?? 0 },
  ];
  return (
    <div className="screen">
      <button className="back" onClick={onFini}>← Retour</button>
      <h1>Espace PMS</h1>
      <p className="hint">Plan de maîtrise sanitaire de {site.nom}. Tout écart devient une action à suivre jusqu'à sa correction.</p>
      {erreur && <p className="pill bad">{erreur}</p>}
      <section className="actions">
        {tuiles.map((t) => (
          <button key={t.s} className="act main" onClick={() => setSection(t.s)} disabled={!actions || !controles || !sondes}>
            <b>{t.titre}</b><span>{t.sous}</span>{t.alerte > 0 && <span className="badge">{t.alerte}</span>}
          </button>
        ))}
      </section>
      <p className="hint">Visites (Eurofins, services officiels) et documents du PMS : bientôt dans cet espace.</p>
    </div>
  );
}

/* ---------- Plan d'action ---------- */
function PlanAction({ actions, setActions, onRetour }: { actions: ActionPlan[]; setActions: (l: ActionPlan[]) => void; onRetour: () => void }) {
  const { api, site, profil } = useContexte();
  const enregistrer = useEnregistrer();
  const toast = useToast();
  const doc = useDocument(api);
  const [profils, setProfils] = useState<Profil[]>([]);
  const [prevoir, setPrevoir] = useState<ActionPlan | null>(null);
  const [corriger, setCorriger] = useState<ActionPlan | null>(null);
  const [voirCloses, setVoirCloses] = useState(false);
  useEffect(() => { api.profils().then(setProfils).catch(() => {}); }, [api]);
  const maj = (id: string, p: Partial<ActionPlan>) => setActions(actions.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const a = auj();
  const liste = actions.filter((x) => voirCloses || x.statut !== "verifiee");

  return (
    <div className="screen">
      <button className="back" onClick={onRetour}>← Espace PMS</button>
      <h1>Plan d'action</h1>
      <p className="hint">Pour chaque écart : l'action prévue, qui s'en charge, pour quand, puis la preuve de correction. Mineure : close par le chef ou le responsable ; majeure : validée par le siège.</p>
      <doc.Visionneuse />
      {!liste.length && <p className="pill ok">Aucune action en cours.</p>}
      {liste.map((x) => {
        const retard = actionEnRetard(x, a);
        return (
          <section key={x.id} className={`card pa-carte g-${x.gravite} ${x.statut}`}>
            <div className="pa-tete">
              <b>{x.titre}</b>
              <span className={`pill ${x.statut === "verifiee" ? "ok" : x.statut === "traitee" ? "warn" : "bad"}`}>{{ ouverte: "À corriger", traitee: "Corrigée", verifiee: "Close" }[x.statut]}</span>
            </div>
            <p className="hint">{x.categorie} · {x.gravite} · signalée le {date(x.cree_at)}{x.photo && <> · <button className="lien" onClick={() => doc.ouvrir(x.photo!, "image/webp")}>photo</button></>}</p>
            {x.action_prevue
              ? <p className={`pa-plan ${retard ? "retard" : ""}`}>→ {x.action_prevue}{x.responsable && <> · <b>{x.responsable}</b></>}{x.echeance && <> · avant le <b>{date(x.echeance)}</b></>}{retard && " · en retard"}</p>
              : x.statut === "ouverte" && <p className="pa-plan retard">Action pas encore prévue</p>}
            {x.traitee_commentaire && <p className="hint">Correction : {x.traitee_commentaire}{x.traitee_par && ` (${x.traitee_par})`}</p>}
            <div className="opts">
              {x.statut === "ouverte" && <button className="opt" onClick={() => setPrevoir(x)}>{x.action_prevue ? "Modifier l'action" : "Prévoir l'action"}</button>}
              {x.statut === "ouverte" && <button className="opt sel" onClick={() => setCorriger(x)}>Corrigé</button>}
              {x.statut === "traitee" && transitionPermise("traitee", "verifiee", profil.role, x.gravite) && (
                <button className="opt sel" onClick={async () => { await enregistrer({ type: "anomalie_statut", anomalie_id: x.id, statut: "verifiee" }); maj(x.id, { statut: "verifiee" }); toast("Action close"); }}>Clore</button>
              )}
              {x.statut === "traitee" && !transitionPermise("traitee", "verifiee", profil.role, x.gravite) && <span className="hint">À valider par {x.gravite === "mineure" ? "le chef" : "le siège"}</span>}
              {x.preuve && <button className="lien" onClick={() => doc.ouvrir(x.preuve!, "image/webp")}>preuve</button>}
            </div>
          </section>
        );
      })}
      <button className="lien" onClick={() => setVoirCloses(!voirCloses)}>{voirCloses ? "Masquer les actions closes" : "Voir aussi les actions closes (30 jours)"}</button>

      {prevoir && <FormPrevoir action={prevoir} profils={profils} onAnnuler={() => setPrevoir(null)} onValider={async (act, ech, resp) => {
        await enregistrer({ type: "action_planifiee", anomalie_id: prevoir.id, action: act, echeance: ech, responsable_id: resp });
        maj(prevoir.id, { action_prevue: act, echeance: ech, responsable_id: resp, responsable: profils.find((p) => p.id === resp)?.nom ?? null });
        setPrevoir(null); toast("Action prévue");
      }} />}
      {corriger && <FormCorriger action={corriger} onAnnuler={() => setCorriger(null)} onValider={async (com, photo) => {
        const chemin = photo ? cheminPhoto(site.id, nouvelId(), Date.now()) : undefined;
        await enregistrer({ type: "anomalie_statut", anomalie_id: corriger.id, statut: "traitee", commentaire: com || undefined, preuve: chemin },
          photo && chemin ? [{ chemin, blob: photo }] : []);
        maj(corriger.id, { statut: "traitee", traitee_commentaire: com || null, traitee_par: profil.nom, preuve: chemin ?? null });
        setCorriger(null); toast("Correction enregistrée");
      }} />}
    </div>
  );
}

function FormPrevoir({ action, profils, onAnnuler, onValider }: {
  action: ActionPlan; profils: Profil[]; onAnnuler: () => void; onValider: (action: string, echeance: string, resp: string | null) => Promise<void>;
}) {
  const [act, setAct] = useState(action.action_prevue ?? "");
  const [ech, setEch] = useState(action.echeance ?? "");
  const [resp, setResp] = useState(action.responsable_id ?? "");
  const [envoi, setEnvoi] = useState(false);
  const manque = act.trim().length < 3 ? "Décrivez l'action" : !ech ? "Choisissez une échéance" : ech < auj() ? "Échéance déjà passée" : null;
  return (
    <div id="sheet" className="open" role="dialog" aria-modal="true">
      <div className="pad" style={{ width: "min(600px,100%)" }}>
        <h3>Action prévue</h3>
        <p className="hint">{action.titre}</p>
        <label className="champ-bloc">Que faut-il faire ?<input className="champ" value={act} onChange={(e) => setAct(e.target.value)} placeholder="Ex. faire changer le joint par le frigoriste" /></label>
        <label className="champ-bloc">Pour quand ?<input className="champ" type="date" min={auj()} value={ech} onChange={(e) => setEch(e.target.value)} /></label>
        <label className="champ-bloc">Qui s'en charge ?
          <select className="champ" value={resp} onChange={(e) => setResp(e.target.value)}>
            <option value="">—</option>{profils.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select></label>
        <div className="btnrow">
          <button className="bigbtn ghost" onClick={onAnnuler}>Annuler</button>
          <button className="bigbtn ok" disabled={!!manque || envoi} onClick={async () => { setEnvoi(true); await onValider(act.trim(), ech, resp || null); }}>{manque ?? "Enregistrer"}</button>
        </div>
      </div>
    </div>
  );
}

function FormCorriger({ action, onAnnuler, onValider }: { action: ActionPlan; onAnnuler: () => void; onValider: (com: string, photo: Blob | null) => Promise<void> }) {
  const { api } = useContexte();
  const [com, setCom] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [envoi, setEnvoi] = useState(false);
  return (
    <div id="sheet" className="open" role="dialog" aria-modal="true">
      <div className="pad" style={{ width: "min(600px,100%)" }}>
        <h3>Qu'avez-vous fait ?</h3>
        <p className="hint">{action.titre}</p>
        <textarea value={com} onChange={(e) => setCom(e.target.value)} maxLength={500} placeholder="Ex. joint changé par Froid Service le 12/11" aria-label="Correction" />
        <ChampPhoto texte="Photo de la correction (preuve)" photo={photo} onPhoto={setPhoto} demo={api.mode === "demo"} />
        <div className="btnrow">
          <button className="bigbtn ghost" onClick={onAnnuler}>Annuler</button>
          <button className="bigbtn ok" disabled={com.trim().length < 3 || envoi} onClick={async () => { setEnvoi(true); await onValider(com.trim(), photo); }}>
            {com.trim().length < 3 ? "Décrivez la correction" : photo ? "Corrigé" : "Corrigé (sans photo)"}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Contrôles périodiques ---------- */
function Controles({ rubrique, controles, setControles, onRetour }: {
  rubrique: RubriqueControle; controles: ControleSite[]; setControles: (l: ControleSite[]) => void; onRetour: () => void;
}) {
  const { api, site, profil } = useContexte();
  const enregistrer = useEnregistrer();
  const toast = useToast();
  const doc = useDocument(api);
  const [ouvert, setOuvert] = useState<ControleSite | null>(null);
  const liste = controles.filter((c) => c.rubrique === rubrique);
  const ordre = { retard: 0, jamais: 1, bientot: 2, a_jour: 3, hors_service: 0 };
  if (ouvert) return <FormControle c={ouvert} onAnnuler={() => setOuvert(null)} onValider={async (d) => {
    const chemin = d.photo ? cheminPhoto(site.id, nouvelId(), Date.now()) : undefined;
    await enregistrer({ type: "controle_fait", id: nouvelId(), modele_id: ouvert.id, date_realisation: d.date, conforme: d.conforme,
      observation: d.observation || undefined, prestataire: d.prestataire || undefined, photo: chemin }, d.photo && chemin ? [{ chemin, blob: d.photo }] : []);
    const prochaine = new Date(`${d.date}T12:00:00`); prochaine.setMonth(prochaine.getMonth() + ouvert.periodicite_mois);
    setControles(controles.map((x) => (x.id === ouvert.id ? { ...x, etat: "a_jour", prochaine: prochaine.toLocaleDateString("sv-SE"),
      dernier: { date: d.date, conforme: d.conforme, observation: d.observation || null, prestataire: d.prestataire || null, photo: chemin ?? null, document: null, par: profil.nom } } : x)));
    setOuvert(null); toast(d.conforme ? "Contrôle enregistré" : "Contrôle enregistré : une action est ajoutée au plan d'action");
  }} />;
  return (
    <div className="screen">
      <button className="back" onClick={onRetour}>← Espace PMS</button>
      <h1>{rubrique === "entretien" ? "Entretien technique" : "Nuisibles (3D)"}</h1>
      <doc.Visionneuse />
      {[...liste].sort((a, b) => ordre[a.etat] - ordre[b.etat]).map((c) => (
        <section key={c.id} className="card pa-carte">
          <div className="pa-tete"><b>{c.titre}</b><Etat e={c.etat} /></div>
          <p className="hint">{PERIODE[c.periodicite_mois]}{c.prestataire && " · par un prestataire"}
            {c.dernier ? <> · dernier le {date(c.dernier.date)} ({c.dernier.conforme ? "conforme" : "non conforme"}{c.dernier.par && `, ${c.dernier.par}`})</> : " · jamais enregistré"}
            {c.prochaine && <> · prochain avant le <b>{date(c.prochaine)}</b></>}</p>
          {c.methode && <p className="pn-methode">{c.methode}</p>}
          <div className="opts">
            <button className="opt sel" onClick={() => setOuvert(c)}>Enregistrer un contrôle</button>
            {c.dernier?.photo && <button className="lien" onClick={() => doc.ouvrir(c.dernier!.photo!, "image/webp")}>dernière photo</button>}
            {c.dernier?.document && <button className="lien" onClick={() => doc.ouvrir(c.dernier!.document!, "application/pdf")}>rapport</button>}
          </div>
        </section>
      ))}
    </div>
  );
}

function FormControle({ c, onAnnuler, onValider }: {
  c: ControleSite; onAnnuler: () => void;
  onValider: (d: { date: string; conforme: boolean; observation: string; prestataire: string; photo: Blob | null }) => Promise<void>;
}) {
  const { api } = useContexte();
  const [d, setD] = useState(auj());
  const [conforme, setConforme] = useState<boolean | null>(null);
  const [obs, setObs] = useState("");
  const [presta, setPresta] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const photoExigee = c.preuve !== "aucune" || conforme === false;
  const manque = conforme === null ? "Conforme ou non ?" : !conforme && obs.trim().length < 3 ? "Décrivez le problème"
    : photoExigee && !photo ? (c.preuve === "document" ? "Photographiez le rapport ou le certificat" : "Prenez la photo") : null;
  return (
    <div className="screen">
      <button className="back" onClick={onAnnuler}>← Annuler</button>
      <h1>{c.titre}</h1>
      {c.methode && <p className="sm-consigne">{c.methode}</p>}
      <section className="card sm-form">
        <label className="champ-bloc">Date du contrôle<input className="champ" type="date" max={auj()} value={d} onChange={(e) => e.target.value && setD(e.target.value)} /></label>
        {c.prestataire && <label className="champ-bloc">Entreprise<input className="champ" value={presta} onChange={(e) => setPresta(e.target.value)} placeholder="Nom du prestataire" /></label>}
        <div className="opts">
          <button className={`opt ${conforme === true ? "sel" : ""}`} onClick={() => setConforme(true)}>Conforme</button>
          <button className={`opt ${conforme === false ? "sel bad" : ""}`} onClick={() => setConforme(false)}>Pas conforme</button>
        </div>
        {conforme === false && <label className="champ-bloc">Quel est le problème ?<input className="champ" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex. joint de la CF positive déchiré" /></label>}
        {conforme === true && <label className="champ-bloc">Remarque (facultatif)<input className="champ" value={obs} onChange={(e) => setObs(e.target.value)} /></label>}
        {(photoExigee || conforme !== null) && <ChampPhoto texte={c.preuve === "document" ? "Photo du rapport ou du certificat" : conforme === false ? "Photo du problème" : "Photo"}
          photo={photo} onPhoto={setPhoto} demo={api.mode === "demo"} />}
        {conforme === false && <p className="hint">Une action sera ajoutée au plan d'action.</p>}
        <button className="bigbtn" disabled={!!manque || envoi} onClick={async () => { setEnvoi(true); await onValider({ date: d, conforme: !!conforme, observation: obs.trim(), prestataire: presta.trim(), photo }); }}>
          {manque ?? "Enregistrer"}</button>
      </section>
    </div>
  );
}

/* ---------- Sondes et thermomètres ---------- */
const METHODES: { cle: MethodeMesure; libelle: string; consigne: string }[] = [
  { cle: "glace", libelle: "Glace fondante", consigne: "Remplissez un verre de glace pilée, complétez d'eau froide, remuez et attendez 3 minutes. Plongez la sonde au centre sans toucher le fond : elle doit afficher 0 °C (± 0,5)." },
  { cle: "ebullition", libelle: "Eau bouillante", consigne: "Plongez la sonde dans l'eau à gros bouillons sans toucher le fond : elle doit afficher 100 °C (± 1)." },
  { cle: "certificat", libelle: "Certificat d'étalonnage", consigne: "Photographiez le certificat remis par le laboratoire ou le fournisseur." },
];

function Sondes({ sondes, setSondes, onRetour, recharger }: { sondes: AppareilMesure[]; setSondes: (l: AppareilMesure[]) => void; onRetour: () => void; recharger: () => void }) {
  const { api, profil } = useContexte();
  const toast = useToast();
  const [verifier, setVerifier] = useState<AppareilMesure | null>(null);
  const [ajout, setAjout] = useState(false);
  const [nom, setNom] = useState(""); const [type, setType] = useState<AppareilMesure["type"]>("sonde"); const [numero, setNumero] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  if (verifier) return <FormVerification a={verifier} onAnnuler={() => setVerifier(null)} onFait={(conforme, methode, valeur) => {
    setSondes(sondes.map((x) => (x.id === verifier.id ? { ...x, hors_service: !conforme, etat: conforme ? "a_jour" : "hors_service",
      dernier: { date: auj(), methode, valeur, conforme, photo: null, document: null, par: profil.nom } } : x)));
    setVerifier(null); toast(conforme ? "Appareil conforme" : "Appareil hors tolérance : retiré du service, action ajoutée");
  }} />;
  return (
    <div className="screen">
      <button className="back" onClick={onRetour}>← Espace PMS</button>
      <h1>Sondes et thermomètres</h1>
      <p className="hint">Chaque appareil qui sert aux relevés est vérifié au moins une fois par an. Un appareil hors tolérance ne doit plus servir.</p>
      {!sondes.length && <p className="pill warn">Aucun appareil enregistré : ajoutez vos sondes et thermomètres.</p>}
      {sondes.map((a) => (
        <section key={a.id} className={`card pa-carte ${a.hors_service ? "hs" : ""}`}>
          <div className="pa-tete"><b>{a.nom}</b><Etat e={a.etat} /></div>
          <p className="hint">{{ sonde: "Sonde", infrarouge: "Thermomètre infrarouge", enregistreur: "Enregistreur", autre: "Appareil" }[a.type]}{a.numero && ` n° ${a.numero}`}
            {a.dernier ? <> · vérifié le {date(a.dernier.date)}{a.dernier.valeur !== null && ` (lu ${a.dernier.valeur} °C)`}</> : " · jamais vérifié"}
            {a.prochaine && !a.hors_service && <> · prochaine avant le <b>{date(a.prochaine)}</b></>}</p>
          {a.hors_service && <p className="pill bad">Hors service : ne plus utiliser pour les relevés</p>}
          <button className="opt sel" onClick={() => setVerifier(a)}>Vérifier</button>
        </section>
      ))}
      {ajout ? (
        <section className="card sm-form">
          <label className="champ-bloc">Nom<input className="champ" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex. Sonde piquante cuisine" /></label>
          <div className="opts">{(["sonde", "infrarouge", "enregistreur", "autre"] as const).map((t) => (
            <button key={t} className={`opt ${type === t ? "sel" : ""}`} onClick={() => setType(t)}>{{ sonde: "Sonde", infrarouge: "Infrarouge", enregistreur: "Enregistreur", autre: "Autre" }[t]}</button>))}</div>
          <label className="champ-bloc">N° de série (facultatif)<input className="champ" value={numero} onChange={(e) => setNumero(e.target.value)} /></label>
          {erreur && <p className="pill bad">{erreur}</p>}
          <div className="opts">
            <button className="opt" onClick={() => setAjout(false)}>Annuler</button>
            <button className="bigbtn" disabled={nom.trim().length < 2} onClick={async () => {
              try { await api.ajouterAppareil(profil.id, nom.trim(), type, numero); setAjout(false); setNom(""); setNumero(""); recharger(); toast("Appareil ajouté"); }
              catch { setErreur("Ajout impossible sans réseau. Réessayez une fois connecté."); }
            }}>Ajouter</button>
          </div>
        </section>
      ) : <button className="opt" onClick={() => { setAjout(true); setErreur(null); }}>+ Ajouter un appareil</button>}
    </div>
  );
}

function FormVerification({ a, onAnnuler, onFait }: { a: AppareilMesure; onAnnuler: () => void; onFait: (conforme: boolean, m: MethodeMesure, v: number | null) => void }) {
  const { api, site } = useContexte();
  const enregistrer = useEnregistrer();
  const [m, setM] = useState<MethodeMesure>("glace");
  const [valeur, setValeur] = useState("");
  const [certifOk, setCertifOk] = useState<boolean | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const v = Number(valeur.replace(",", "."));
  const lisible = valeur.trim() !== "" && Number.isFinite(v);
  const conforme = m === "certificat" ? certifOk : lisible ? lectureConforme(m, v) : null;
  const manque = m !== "certificat" && !lisible ? "Saisissez la valeur lue" : m === "certificat" && certifOk === null ? "Certificat conforme ?" : !photo ? "Prenez la photo" : null;
  return (
    <div className="screen">
      <button className="back" onClick={onAnnuler}>← Annuler</button>
      <h1>Vérifier : {a.nom}</h1>
      <div className="opts">{METHODES.map((x) => <button key={x.cle} className={`opt ${m === x.cle ? "sel" : ""}`} onClick={() => { setM(x.cle); setValeur(""); }}>{x.libelle}</button>)}</div>
      <p className="sm-consigne">{METHODES.find((x) => x.cle === m)!.consigne}</p>
      <section className="card sm-form">
        {m !== "certificat" ? (
          <label className="champ-bloc">Valeur affichée (°C)<input className="champ" inputMode="decimal" value={valeur} onChange={(e) => setValeur(e.target.value)} placeholder={m === "glace" ? "Ex. 0,2" : "Ex. 99,6"} /></label>
        ) : (
          <div className="opts">
            <button className={`opt ${certifOk === true ? "sel" : ""}`} onClick={() => setCertifOk(true)}>Certificat conforme</button>
            <button className={`opt ${certifOk === false ? "sel bad" : ""}`} onClick={() => setCertifOk(false)}>Non conforme</button>
          </div>
        )}
        {conforme !== null && <p className={`pill ${conforme ? "ok" : "bad"}`}>{conforme ? "Dans la tolérance" : "Hors tolérance : l'appareil sera retiré du service"}</p>}
        <ChampPhoto texte={m === "certificat" ? "Photo du certificat" : "Photo de l'appareil dans le bain, valeur lisible"} photo={photo} onPhoto={setPhoto} demo={api.mode === "demo"} />
        <button className="bigbtn" disabled={!!manque || envoi} onClick={async () => {
          setEnvoi(true);
          const chemin = cheminPhoto(site.id, nouvelId(), Date.now());
          await enregistrer({ type: "verification_mesure", id: nouvelId(), appareil_id: a.id, methode: m, valeur: m === "certificat" ? undefined : v, conforme: !!conforme, photo: chemin },
            [{ chemin, blob: photo! }]);
          onFait(!!conforme, m, m === "certificat" ? null : v);
        }}>{manque ?? "Enregistrer"}</button>
      </section>
    </div>
  );
}
