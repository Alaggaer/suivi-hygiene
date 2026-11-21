import { useEffect, useMemo, useState } from "react";
import type { AnomalieSiege, Api, Correction, EtatRestaurant, JourHistorique, Preuves, TableCorrigeable } from "../types";
import { BORNES_HUILE, bornesReleve, dansBornes, depuis, indicateursRestaurant, trierRestaurants, type Bornes, type Indicateur, type NiveauResto } from "../logique";

/**
 * Espace siège :
 * - accueil : une carte par restaurant (rouge / orange / vert), les plus préoccupants d'abord ;
 * - fiche restaurant : à traiter, la journée, températures, huile, livraisons, traçabilité, 30 jours ; imprimable en PDF ;
 * - anomalies à vérifier de tout le groupe.
 */
type Vue = { nom: "accueil" } | { nom: "resto"; id: string } | { nom: "anomalies" };

const NIV: Record<NiveauResto, { libelle: string; cls: string }> = {
  rouge: { libelle: "À surveiller", cls: "bad" }, orange: { libelle: "Attention", cls: "warn" }, vert: { libelle: "RAS", cls: "ok" },
};
const G = { critique: "bad", majeure: "warn", mineure: "none" } as const;
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const quand = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
/** « reçue 15:07 » quand la saisie (faite hors ligne) est arrivée au serveur plus de 10 min après avoir été faite. */
function Recu({ at, recu }: { at: string; recu?: string }) {
  if (!recu || Math.abs(new Date(recu).getTime() - new Date(at).getTime()) < 10 * 60_000) return null;
  return <span className="recu" title="Saisie faite hors ligne, envoyée plus tard"> · reçue {heure(recu)}</span>;
}
const deg = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("fr-FR")} °C`);
const aujourdHui = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
const jourLong = (j: string) => new Date(`${j}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function TableauSiege({ api }: { api: Api }) {
  const [vue, setVue] = useState<Vue>({ nom: "accueil" });
  const [etats, setEtats] = useState<EtatRestaurant[] | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalieSiege[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [maintenant, setMaintenant] = useState(() => new Date());

  const charger = () => Promise.all([api.etatRestaurants(), api.anomaliesSiege()])
    .then(([e, a]) => { setEtats(e); setAnomalies(a); setErreur(null); setMaintenant(new Date()); })
    .catch((e) => setErreur((e as Error).message));
  useEffect(() => {
    charger();
    const t = setInterval(charger, 60_000);   // l'accueil se met à jour tout seul chaque minute
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  useEffect(() => { window.scrollTo?.(0, 0); }, [vue]);

  const aVerifier = anomalies.filter((a) => a.statut === "traitee").length;
  const tries = useMemo(() => (etats ? trierRestaurants(etats, maintenant) : []), [etats, maintenant]);

  if (erreur && !etats) return <p className="pill bad">{erreur}</p>;
  if (!etats) return <p className="hint">Chargement…</p>;

  return (
    <div className="siege3">
      <div className="s3-barre">
        {vue.nom !== "accueil" && <button className="s3-retour" onClick={() => setVue({ nom: "accueil" })}>← Tous les restaurants</button>}
        <span className="s3-date">{new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" })}</span>
        <button className={`s3-averifier ${aVerifier ? "" : "zero"}`} onClick={() => setVue({ nom: "anomalies" })}>
          {aVerifier ? `${aVerifier} à vérifier` : "Anomalies"}
        </button>
      </div>
      {vue.nom === "accueil" && <Accueil tries={tries} anomalies={anomalies} onOuvrir={(id) => setVue({ nom: "resto", id })} />}
      {vue.nom === "resto" && (
        <Fiche api={api} etat={tries.find((e) => e.site_id === vue.id)!} anomalies={anomalies.filter((a) => a.site_id === vue.id)}
          onChange={charger} maintenant={maintenant} />
      )}
      {vue.nom === "anomalies" && <AnomaliesGroupe api={api} liste={anomalies} onChange={charger} onOuvrir={(id) => setVue({ nom: "resto", id })} />}
    </div>
  );
}

/* ---------- Accueil ---------- */

type Trie = ReturnType<typeof trierRestaurants<EtatRestaurant>>[number];

function Accueil({ tries, anomalies, onOuvrir }: { tries: Trie[]; anomalies: AnomalieSiege[]; onOuvrir: (id: string) => void }) {
  const [filtre, setFiltre] = useState<NiveauResto | "tous">("tous");
  const n = (v: NiveauResto) => tries.filter((e) => e.statut.niveau === v).length;
  const critiques = anomalies.filter((a) => a.gravite === "critique" && a.statut !== "verifiee");
  const nomsCritiques = [...new Set(critiques.map((a) => a.restaurant))];
  const echues = tries.reduce((s, e) => s + e.taches_echues, 0);
  const faitesEchues = tries.reduce((s, e) => s + (e.taches_echues - e.taches_en_retard), 0);
  const retard = tries.reduce((s, e) => s + e.taches_en_retard, 0);
  const muettes = tries.filter((e) => e.statut.silencieuse);
  const taux = echues ? Math.round((faitesEchues / echues) * 100) : null;
  const vues = filtre === "tous" ? tries : tries.filter((e) => e.statut.niveau === filtre);

  return (
    <main className="s3-main">
      <section className="s3-chiffres" aria-label="Résumé du jour">
        <Chiffre niveau={n("rouge") ? "bad" : "ok"} titre="Restaurants à surveiller" val={`${n("rouge")}`} sous={`sur ${tries.length} aujourd'hui`} />
        <Chiffre niveau={critiques.length ? "bad" : "ok"} titre="Anomalies critiques en cours" val={`${critiques.length}`} sous={nomsCritiques.join(" · ") || "aucune"} />
        <Chiffre niveau={taux === null ? "ok" : taux >= 95 ? "ok" : taux >= 85 ? "warn" : "bad"} titre="Tâches échues faites" val={taux === null ? "—" : `${taux} %`} sous={`${retard} en retard`} />
        <Chiffre niveau={muettes.length ? "warn" : "ok"} titre="Tablettes silencieuses" val={`${muettes.length}`} sous={muettes.map((e) => e.nom).join(" · ") || "toutes actives"} />
      </section>

      <section aria-label="Restaurants">
        <div className="s3-titre">
          <h1>Les restaurants</h1>
          <span className="hint">les plus préoccupants d'abord · touchez une carte pour entrer</span>
          <div className="s3-filtres" role="group" aria-label="Filtrer">
            {([["tous", `Tous (${tries.length})`], ["rouge", `À surveiller (${n("rouge")})`], ["orange", `Attention (${n("orange")})`], ["vert", `RAS (${n("vert")})`]] as const).map(([v, l]) => (
              <button key={v} className={`opt ${filtre === v ? "sel" : ""}`} onClick={() => setFiltre(v)}>{l}</button>
            ))}
          </div>
        </div>
        {!vues.length && <p className="hint">Aucun restaurant dans cette catégorie.</p>}
        <div className="s3-cartes">
          {vues.map((e) => <CarteResto key={e.site_id} e={e} onOuvrir={() => onOuvrir(e.site_id)} />)}
        </div>
      </section>
    </main>
  );
}

function Chiffre({ niveau, titre, val, sous }: { niveau: "ok" | "warn" | "bad"; titre: string; val: string; sous: string }) {
  return (
    <div className={`s3-chiffre ${niveau}`}>
      <span>{titre}</span><b>{val}</b><small>{sous}</small>
    </div>
  );
}

function CarteResto({ e, onOuvrir }: { e: Trie; onOuvrir: () => void }) {
  const s = NIV[e.statut.niveau];
  // La ligne d'activité dit déjà « tablette silencieuse » : on montre alors la raison suivante.
  const raison = e.statut.raisons.find((r) => !(e.statut.silencieuse && /silencieuse|Aucune saisie/.test(r)));
  return (
    <button className={`s3-carte ${s.cls}`} onClick={onOuvrir} aria-label={`${e.nom}, ${s.libelle}${raison ? `, ${raison}` : ""}`}>
      <span className="s3-carte-tete">
        <span><b className="s3-nom">{e.nom}</b><span className="hint">{e.ville}</span></span>
        <span className={`pill ${s.cls}`}>{s.libelle}</span>
      </span>
      <span className="s3-taches"><b>{e.taches_faites}/{e.taches_total} tâches</b> <span className="hint">{e.taches_en_retard ? `· ${e.taches_en_retard} en retard` : "· à l'heure"}</span></span>
      <span className="s3-inds">
        {indicateursRestaurant(e).map((i) => <Ind key={i.nom} i={i} />)}
      </span>
      {raison && e.statut.niveau !== "vert" && <span className={`s3-raison t-${s.cls}`}>{raison}</span>}
      <span className={`s3-activite ${e.statut.silencieuse ? "t-warn" : ""}`}>
        {e.statut.silencieuse
          ? (e.derniere_saisie ? `Tablette silencieuse depuis ${depuis(e.derniere_saisie)}` : "Aucune saisie depuis 7 jours")
          : e.derniere_saisie ? `Dernière saisie il y a ${depuis(e.derniere_saisie)}${e.derniere_saisie_par ? ` · ${e.derniere_saisie_par}` : ""}` : "Aucune saisie"}
      </span>
    </button>
  );
}

function Ind({ i }: { i: Indicateur }) {
  return <span className="s3-ind"><span className={`pt ${i.niveau}`} aria-hidden="true" /><span className="hint">{i.nom}</span> <b className={i.niveau === "bad" || i.niveau === "warn" ? `t-${i.niveau}` : ""}>{i.val}</b></span>;
}

/* ---------- Fiche restaurant ---------- */

function Fiche({ api, etat, anomalies, onChange, maintenant }: { api: Api; etat: Trie | undefined; anomalies: AnomalieSiege[]; onChange: () => void; maintenant: Date }) {
  const [jour, setJour] = useState(aujourdHui());
  const [p, setP] = useState<Preuves | null>(null);
  const [hist, setHist] = useState<JourHistorique[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [aCorriger, setACorriger] = useState<ACorriger | null>(null);
  const [rattraper, setRattraper] = useState<"releve" | "huile" | null>(null);
  const [rev, setRev] = useState(0);
  const id = etat?.site_id;

  useEffect(() => {
    if (!id) return;
    setP(null); setErreur(null);
    api.preuvesJour(id, jour).then(setP).catch((e) => setErreur((e as Error).message));
  }, [api, id, jour, rev]);
  useEffect(() => { if (id) api.historiqueSite(id, 30).then(setHist).catch(() => setHist([])); }, [api, id]);
  // Miniatures : liens temporaires vers les photos (bons de livraison, étiquettes).
  useEffect(() => {
    if (!p) return;
    const chemins = [...p.livraisons.map((l) => l.photo_bl), ...p.produits.map((u) => u.photo)];
    let fini = false;
    Promise.all(chemins.map((c) => api.urlPhoto(c).then((u) => [c, u] as const).catch(() => null)))
      .then((r) => { if (!fini) setUrls(Object.fromEntries(r.filter(Boolean) as (readonly [string, string])[])); });
    return () => { fini = true; };
  }, [api, p]);

  if (!etat) return <p className="hint">Restaurant introuvable.</p>;
  const s = NIV[etat.statut.niveau];
  const ouvertes = anomalies.filter((a) => a.statut !== "verifiee");
  const estAujourdHui = jour === aujourdHui();
  const hier = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

  return (
    <main className="s3-main s3-fiche">
      <div className="s3-fiche-tete">
        <div>
          <h1>{etat.nom} <span className="hint">· {etat.ville}</span></h1>
          <p className="hint imprime-seul">Dossier de contrôle · {jourLong(jour)} · édité le {quand(new Date().toISOString())}</p>
          <p className="hint ecran-seul">
            {etat.statut.silencieuse ? <span className="t-warn">Tablette silencieuse</span> : etat.derniere_saisie ? `Dernière saisie il y a ${depuis(etat.derniere_saisie, maintenant)}${etat.derniere_saisie_par ? ` · ${etat.derniere_saisie_par}` : ""}` : "Aucune saisie récente"}
          </p>
        </div>
        <span className={`pill ${s.cls} ecran-seul`}>{s.libelle}</span>
      </div>

      <div className="s3-jours ecran-seul">
        <button className={`opt ${jour === aujourdHui() ? "sel" : ""}`} onClick={() => setJour(aujourdHui())}>Aujourd'hui</button>
        <button className={`opt ${jour === hier ? "sel" : ""}`} onClick={() => setJour(hier)}>Hier</button>
        <label className="s3-autre">Autre jour <input className="champ" type="date" value={jour} max={aujourdHui()} onChange={(e) => e.target.value && setJour(e.target.value)} /></label>
        <button className="s3-pdf" onClick={() => window.print()}>Dossier de contrôle (PDF)</button>
      </div>

      {ouvertes.length > 0 && <ATraiter api={api} liste={ouvertes} onChange={onChange} />}
      {estAujourdHui && etat.statut.raisons.length > 0 && ouvertes.length === 0 && (
        <p className={`s3-raisons t-${s.cls}`}>{etat.statut.raisons.join(" · ")}</p>
      )}

      {erreur && <p className="pill bad">{erreur}</p>}
      {!p && !erreur && <p className="hint">Chargement…</p>}
      {p && (
        <>
          <div className="s3-deux">
            <section className="s3-bloc" aria-label="La journée">
              <h2>La journée <small>{p.taches.filter((t) => t.faite_at).length} tâches faites sur {p.taches.length}</small></h2>
              {!p.taches.length ? <p className="hint">Aucune tâche prévue.</p> : (
                <ol className="s3-journee">
                  {p.taches.map((t, i) => {
                    const passee = new Date(t.echeance) < new Date();
                    const [lib, cls] = t.faite_at
                      ? [new Date(t.faite_at) <= new Date(t.echeance) ? `faite ${heure(t.faite_at)}` : `en retard · ${heure(t.faite_at)}`, new Date(t.faite_at) <= new Date(t.echeance) ? "ok" : "warn"]
                      : passee ? ["non faite", "bad"] : ["à venir", "none"];
                    return <li key={i}><span className="num hint">{heure(t.echeance)}</span><span>{t.titre}{t.par ? <span className="hint"> · {t.par}</span> : null}</span><span className={`pill ${cls}`}>{lib}</span></li>;
                  })}
                </ol>
              )}
            </section>
            <div className="s3-pile">
              <section className="s3-bloc" aria-label="Températures">
                <h2>Températures <small>{p.releves.length} relevés</small>
                  <button className="lien ecran-seul s3-oubli" onClick={() => setRattraper("releve")}>+ Relevé oublié</button></h2>
                {!p.releves.length ? <p className="hint">Aucun relevé ce jour.</p> : (
                  <div className="table-scroll"><table className="tbl"><tbody>{p.releves.map((r, i) => {
                    const v = r.correction ? r.correction.valeur : r.valeur;
                    const conforme = v === null ? true : v <= r.t_max;
                    return (
                      <tr key={i} className={r.correction ? "corrigee" : ""}><td className="num hint">{heure(r.at)}<Recu at={r.at} recu={r.recu_at} /></td><td><b>{r.enceinte}</b></td>
                        <td className={`num ${conforme ? "" : "t-bad"}`}>{r.correction ? <><s>{deg(r.valeur)}</s> <b>{v === null ? "annulé" : deg(v)}</b></> : <b>{deg(r.valeur)}</b>}</td>
                        <td>{conforme ? <span className="hint">max {deg(r.t_max)}</span> : <><span className="pill bad">max {deg(r.t_max)}</span>{r.action && <><br /><span className="hint">{r.action}</span></>}</>}
                          {r.correction && <><br /><Corr c={r.correction} /></>}
                          {r.rattrapage && <><br /><span className="corr">Saisi après coup par le siège : « {r.rattrapage} »</span></>}</td>
                        <td className="hint">{r.par}</td>
                        <td className="ecran-seul"><button className="lien" onClick={() => setACorriger({ table: "releves", id: r.id, libelle: `${r.enceinte} · ${deg(r.valeur)} à ${heure(r.at)}`, unite: "°C", bornes: bornesReleve(r.t_max) })}>Corriger</button></td></tr>
                    );
                  })}</tbody></table></div>
                )}
              </section>
              <section className="s3-bloc" aria-label="Huile">
                <h2>Huile <button className="lien ecran-seul s3-oubli" onClick={() => setRattraper("huile")}>+ Mesure oubliée</button></h2>
                {!p.huiles.length ? <p className="hint">Aucune mesure ce jour.</p> : (
                  <div className="s3-friteuses">{p.huiles.map((h, i) => {
                    const v = h.correction ? h.correction.valeur : h.polaires, cls = h.non_utilisee ? "none" : v === null ? "none" : v >= 25 ? "bad" : v >= 20 ? "warn" : "ok";
                    return (
                      <div key={i} className="s3-friteuse">
                        <div className="s3-friteuse-tete"><b>{h.friteuse}</b><b className={cls === "bad" || cls === "warn" ? `t-${cls}` : ""}>{h.non_utilisee ? "—" : v === null ? "—" : `${v.toLocaleString("fr-FR")} %`}</b></div>
                        <div className="s3-jauge"><span className={cls} style={{ width: `${Math.min(100, ((v ?? 0) / 25) * 100)}%` }} /></div>
                        <div className="hint">{h.non_utilisee ? "non utilisée" : [h.filtrage && "filtrée", h.changement && "huile changée"].filter(Boolean).join(" · ") || "mesurée"} · {heure(h.at)}<Recu at={h.at} recu={h.recu_at} /> · {h.par}</div>
                        {h.rattrapage && <div className="corr">Saisie après coup par le siège : « {h.rattrapage} »</div>}
                        {h.correction && <div><s className="hint">{h.polaires === null ? "—" : `${h.polaires.toLocaleString("fr-FR")} %`}</s> <Corr c={h.correction} /></div>}
                        {!h.non_utilisee && <button className="lien ecran-seul" onClick={() => setACorriger({ table: "huiles", id: h.id, libelle: `${h.friteuse} · ${h.polaires ?? "—"} % à ${heure(h.at)}`, unite: "%", bornes: BORNES_HUILE })}>Corriger</button>}
                      </div>
                    );
                  })}</div>
                )}
              </section>
            </div>
          </div>

          <section className="s3-bloc" aria-label="Livraisons">
            <h2>Livraisons <small>{p.livraisons.length}</small></h2>
            {!p.livraisons.length ? <p className="hint">Aucune livraison ce jour.</p> : (
              <div className="s3-livraisons">{p.livraisons.map((l, i) => (
                <div key={i} className="s3-livraison">
                  <button className="s3-vignette" onClick={() => urls[l.photo_bl] && setPhoto(urls[l.photo_bl])} aria-label={`Bon de livraison ${l.fournisseur}`}>
                    {urls[l.photo_bl] ? <img src={urls[l.photo_bl]} alt="" /> : <span>BL</span>}
                  </button>
                  <div>
                    <div><b>{l.fournisseur}</b> <span className="hint">· {heure(l.at)}<Recu at={l.at} recu={l.recu_at} /> · {l.par}</span></div>
                    <div className="hint">Camion {deg(l.t_camion)}{l.t_frais !== null ? ` · frais ${deg(l.t_frais)}` : ""}{l.t_surgele !== null ? ` · surgelé ${deg(l.t_surgele)}` : ""}</div>
                    {l.viande && <div className="hint">Viande · origine {l.origine_ok ? "vérifiée" : "non vérifiée"}</div>}
                    <div className="s3-pills">
                      <span className={`pill ${l.conforme ? "ok" : "bad"}`}>{l.conforme ? "conforme" : "non conforme"}</span>
                      <span className={`pill ${l.range_at ? "none" : "warn"}`}>{l.range_at ? `rangée ${heure(l.range_at)}` : "rangement non validé"}</span>
                    </div>
                    {!l.conforme && <div className="hint">{(l.motifs ?? []).join(", ")} · {l.action}</div>}
                    {l.correction && <Corr c={l.correction} />}
                    <button className="lien ecran-seul" onClick={() => setACorriger({ table: "livraisons", id: l.id, libelle: `${l.fournisseur} à ${heure(l.at)}`, unite: null, bornes: null })}>Corriger</button>
                  </div>
                </div>
              ))}</div>
            )}
          </section>

          <section className="s3-bloc" aria-label="Traçabilité produits">
            <h2>Traçabilité produits <small>{p.produits.length} étiquettes</small></h2>
            {!p.produits.length ? <p className="hint">Aucune étiquette ce jour.</p> : (
              <div className="s3-produits">{p.produits.map((u, i) => (
                <button key={i} className="s3-produit" onClick={() => urls[u.photo] && setPhoto(urls[u.photo])} aria-label={`Étiquette ${u.famille}`}>
                  <span className="s3-produit-img">{urls[u.photo] ? <img src={urls[u.photo]} alt="" /> : null}</span>
                  <span className="s3-produit-txt"><b>{u.famille}</b><br /><span className="hint">{u.service} · {heure(u.at)}<Recu at={u.at} recu={u.recu_at} /> · {u.par}</span></span>
                </button>
              ))}</div>
            )}
          </section>

          {p.anomalies.length > 0 && (
            <section className="s3-bloc" aria-label="Anomalies du jour">
              <h2>Anomalies signalées ce jour</h2>
              <div className="table-scroll"><table className="tbl"><tbody>{p.anomalies.map((a, i) => (
                <tr key={i}><td className="num hint">{heure(a.at)}</td><td>{a.titre}</td><td><span className={`pill ${G[a.gravite]}`}>{a.gravite}</span></td>
                  <td className="hint">{a.statut === "ouverte" ? "à traiter" : a.statut === "traitee" ? "traitée, à vérifier" : "vérifiée"}</td></tr>
              ))}</tbody></table></div>
            </section>
          )}
        </>
      )}

      {hist.length > 0 && <Tendance hist={hist} />}
      {rattraper && <FormRattrapage api={api} siteId={etat.site_id} type={rattraper} jour={jour}
        onFermer={() => setRattraper(null)} onFait={() => { setRattraper(null); setRev((x) => x + 1); onChange(); }} />}
      {aCorriger && <FormCorrection api={api} cible={aCorriger} onFermer={() => setACorriger(null)} onFait={() => { setACorriger(null); setRev((x) => x + 1); onChange(); }} />}

      {photo && (
        <div className="visionneuse" onClick={() => setPhoto(null)} role="dialog" aria-label="Photo">
          <img src={photo} alt="Photo" />
          <button className="opt">Fermer</button>
        </div>
      )}
    </main>
  );
}

function Tendance({ hist }: { hist: JourHistorique[] }) {
  const ech = hist.reduce((s, h) => s + h.taches_echues, 0), ok = hist.reduce((s, h) => s + h.taches_a_lheure, 0);
  const crit = hist.reduce((s, h) => s + h.anomalies_critiques, 0), anom = hist.reduce((s, h) => s + h.anomalies, 0);
  return (
    <section className="s3-bloc ecran-seul" aria-label="30 derniers jours">
      <h2>30 derniers jours</h2>
      <p className="hint">Tâches faites à l'heure, jour par jour · moyenne {ech ? Math.round((ok / ech) * 100) : "—"} % · {anom} anomalie{anom > 1 ? "s" : ""} dont {crit} critique{crit > 1 ? "s" : ""}</p>
      <div className="s3-barres" role="img" aria-label="Part des tâches faites à l'heure sur 30 jours">
        {hist.map((h) => {
          const t = h.taches_echues ? h.taches_a_lheure / h.taches_echues : null;
          const cls = t === null ? "none" : t >= 0.95 ? "ok" : t >= 0.85 ? "warn" : "bad";
          return <span key={h.jour} className={cls} style={{ height: `${t === null ? 6 : Math.max(6, t * 100)}%` }} title={`${h.jour} : ${t === null ? "rien d'échu" : `${Math.round(t * 100)} %`}${h.anomalies_critiques ? " · critique" : ""}`} />;
        })}
      </div>
    </section>
  );
}

/* ---------- Anomalies : traiter / vérifier ---------- */

function useAction(api: Api, onChange: () => void) {
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const agir = async (id: string, statut: "traitee" | "verifiee", commentaire?: string) => {
    setEnCours(id); setErreur(null);
    try { await api.siegeChangerStatut(id, statut, commentaire?.trim() || undefined); onChange(); }
    catch (e) { setErreur((e as Error).message); }
    finally { setEnCours(null); }
  };
  return { enCours, erreur, agir };
}

function CarteAnomalie({ a, avecResto, enCours, agir, onOuvrir }: {
  a: AnomalieSiege; avecResto: boolean; enCours: boolean; agir: (id: string, s: "traitee" | "verifiee", c?: string) => void; onOuvrir?: () => void;
}) {
  const [com, setCom] = useState("");
  return (
    <div className={`carte s3-anom ${a.statut === "verifiee" ? "" : a.gravite === "critique" ? "bad" : a.statut === "traitee" ? "warn" : ""}`}>
      <div className="carte-tete">
        {avecResto ? <button className="lien" onClick={onOuvrir}><b>{a.restaurant}</b></button> : <b>{a.titre}</b>}
        <span className={`pill ${a.statut === "traitee" ? "warn" : G[a.gravite]}`}>{a.statut === "traitee" ? "à vérifier" : a.statut === "verifiee" ? "vérifiée" : a.gravite}</span>
      </div>
      {avecResto && <p className="carte-titre">{a.titre}</p>}
      <p className="hint">{a.categorie} · signalée {quand(a.cree_at)}{a.cree_par ? ` par ${a.cree_par}` : " automatiquement"}</p>
      {a.traitee_at && <p className="hint">Traitée {quand(a.traitee_at)} par {a.traitee_par}{a.traitee_commentaire ? ` : « ${a.traitee_commentaire} »` : ""}</p>}
      {a.verifiee_at && <p className="hint">Vérifiée {quand(a.verifiee_at)} par {a.verifiee_par}</p>}
      {a.statut === "ouverte" && (
        <div className="carte-actions">
          <label className="champ-label"><span className="sr">Ce qui a été fait</span>
            <input className="champ" placeholder="Ce qui a été fait (facultatif)" value={com} onChange={(e) => setCom(e.target.value)} />
          </label>
          <button className="opt" disabled={enCours} onClick={() => agir(a.id, "traitee", com)}>Marquer traitée</button>
        </div>
      )}
      {a.statut === "traitee" && (
        <div className="carte-actions"><button className="s3-verifier" disabled={enCours} onClick={() => agir(a.id, "verifiee")}>Vérifier et clore</button></div>
      )}
    </div>
  );
}

function ATraiter({ api, liste, onChange }: { api: Api; liste: AnomalieSiege[]; onChange: () => void }) {
  const { enCours, erreur, agir } = useAction(api, onChange);
  return (
    <section className="s3-atraiter" aria-label="À traiter">
      <h2>À traiter <small>{liste.length} anomalie{liste.length > 1 ? "s" : ""}</small></h2>
      {erreur && <p className="pill bad">{erreur}</p>}
      <div className="cartes">{liste.map((a) => <CarteAnomalie key={a.id} a={a} avecResto={false} enCours={enCours === a.id} agir={agir} />)}</div>
    </section>
  );
}

function AnomaliesGroupe({ api, liste, onChange, onOuvrir }: { api: Api; liste: AnomalieSiege[]; onChange: () => void; onOuvrir: (id: string) => void }) {
  const [filtre, setFiltre] = useState<"traitee" | "ouverte" | "verifiee">(liste.some((a) => a.statut === "traitee") ? "traitee" : "ouverte");
  const { enCours, erreur, agir } = useAction(api, onChange);
  const n = (s: string) => liste.filter((a) => a.statut === s).length;
  const vues = liste.filter((a) => a.statut === filtre);
  return (
    <main className="s3-main">
      <div className="s3-titre"><h1>Anomalies du groupe</h1><span className="hint">les critiques d'abord, puis les plus anciennes</span></div>
      <div className="s3-filtres">
        <button className={`opt ${filtre === "traitee" ? "sel" : ""}`} onClick={() => setFiltre("traitee")}>À vérifier ({n("traitee")})</button>
        <button className={`opt ${filtre === "ouverte" ? "sel" : ""}`} onClick={() => setFiltre("ouverte")}>À traiter ({n("ouverte")})</button>
        <button className={`opt ${filtre === "verifiee" ? "sel" : ""}`} onClick={() => setFiltre("verifiee")}>Vérifiées · 7 jours ({n("verifiee")})</button>
      </div>
      {erreur && <p className="pill bad">{erreur}</p>}
      {!vues.length && <p className="hint">Rien ici.</p>}
      <div className="cartes">{vues.map((a) => <CarteAnomalie key={a.id} a={a} avecResto enCours={enCours === a.id} agir={agir} onOuvrir={() => onOuvrir(a.site_id)} />)}</div>
    </main>
  );
}

/* ---------- Rattrapage : correction d'une saisie par le siège ---------- */

type ACorriger = { table: TableCorrigeable; id: string; libelle: string; unite: string | null; bornes: Bornes | null };

function Corr({ c }: { c: Correction }) {
  return <span className="corr">Corrigé par {c.par} le {quand(c.at)} : « {c.motif} »{c.valeur === null ? " · saisie annulée" : ""}</span>;
}

const MOTIFS = ["Erreur de saisie (faute de frappe)", "Signe moins oublié", "Mauvaise enceinte ou friteuse", "Saisie en double"];

function FormCorrection({ api, cible, onFermer, onFait }: { api: Api; cible: ACorriger; onFermer: () => void; onFait: () => void }) {
  const [motif, setMotif] = useState("");
  const [valeur, setValeur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const v = valeur.trim() === "" ? null : Number(valeur.replace(",", "."));
  const valeurKo = v !== null && (Number.isNaN(v) || (cible.bornes !== null && !dansBornes(v, cible.bornes)));
  const possible = motif.trim().length >= 5 && !valeurKo && !envoi;
  async function valider() {
    setEnvoi(true); setErreur(null);
    try { await api.siegeCorriger(cible.table, cible.id, motif.trim(), cible.unite ? v : null); onFait(); }
    catch (e) { setErreur((e as Error).message); setEnvoi(false); }
  }
  return (
    <div id="sheet" className="open" role="dialog" aria-modal="true" aria-label="Corriger une saisie" onClick={(e) => e.target === e.currentTarget && onFermer()}>
      <div className="pad correction">
        <h3>Corriger une saisie</h3>
        <p><b>{cible.libelle}</b></p>
        <p className="hint">La saisie d'origine reste visible, barrée. Votre correction est ajoutée avec votre nom, la date et le motif.</p>
        <label className="champ-bloc">Motif (obligatoire)
          <span className="opts">{MOTIFS.map((m) => <button key={m} type="button" className={`opt ${motif === m ? "sel" : ""}`} onClick={() => setMotif(m)}>{m}</button>)}</span>
          <input className="champ" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ou écrivez le motif" />
        </label>
        {cible.unite && (
          <label className="champ-bloc">Bonne valeur ({cible.unite}), si elle est connue
            <input className="champ" inputMode="decimal" value={valeur} onChange={(e) => setValeur(e.target.value)} placeholder="Vide = saisie annulée" />
            {valeurKo && <span className="t-bad">{cible.bornes?.message ?? "Valeur invalide."}</span>}
          </label>
        )}
        {erreur && <p className="pill bad">{erreur}</p>}
        <div className="carte-actions">
          <button className="opt" onClick={onFermer}>Annuler</button>
          <button className="s3-verifier" disabled={!possible} onClick={valider}>{envoi ? "Enregistrement…" : "Enregistrer la correction"}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Rattrapage : saisie oubliée, ajoutée après coup par le siège ---------- */

const ACTIONS_RELEVE = ["Thermostat réglé", "Porte mal fermée, refermée", "Denrées déplacées", "Denrées jetées", "Technicien appelé"];
const MOTIFS_OUBLI = ["Relevé fait sur papier, pas sur la tablette", "Tablette en panne ou déchargée", "Oubli de saisie, valeur connue"];

function FormRattrapage({ api, siteId, type, jour, onFermer, onFait }: {
  api: Api; siteId: string; type: "releve" | "huile"; jour: string; onFermer: () => void; onFait: () => void;
}) {
  const [eq, setEq] = useState<{ id: string; nom: string; t_max?: number }[]>([]);
  const [equipement, setEquipement] = useState("");
  const [heureSaisie, setHeureSaisie] = useState("");
  const [valeur, setValeur] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [decision, setDecision] = useState<"filtree" | "changee" | null>(null);
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    api.equipementsSite(siteId).then((r) => {
      const l = type === "releve" ? r.enceintes : r.friteuses;
      setEq(l); setEquipement(l[0]?.id ?? "");
    }).catch((e) => setErreur((e as Error).message));
  }, [api, siteId, type]);

  const choisi = eq.find((x) => x.id === equipement);
  const bornes = type === "releve" ? (choisi?.t_max !== undefined ? bornesReleve(choisi.t_max) : null) : BORNES_HUILE;
  const v = valeur.trim() === "" ? null : Number(valeur.replace(",", "."));
  const valeurKo = v === null || Number.isNaN(v) || (bornes !== null && !dansBornes(v, bornes));
  const at = heureSaisie ? new Date(`${jour}T${heureSaisie}:00`) : null;
  const futur = !!at && at.getTime() > Date.now();
  const horsSeuil = type === "releve" && v !== null && choisi?.t_max !== undefined && v > choisi.t_max;
  const rouge = type === "huile" && v !== null && v >= 25;
  const decisionOk = type === "releve" ? (!horsSeuil || !!action) : (decision === "changee" || (decision === "filtree" && !rouge));
  const possible = !!equipement && !!at && !futur && !valeurKo && decisionOk && motif.trim().length >= 5 && !envoi;

  async function valider() {
    setEnvoi(true); setErreur(null);
    try {
      await api.siegeRattraper(type === "releve"
        ? { type, equipement, at: at!.toISOString(), valeur: v!, motif: motif.trim(), action: horsSeuil ? action : null }
        : { type, equipement, at: at!.toISOString(), valeur: v!, motif: motif.trim(), decision: decision! });
      onFait();
    } catch (e) { setErreur((e as Error).message); setEnvoi(false); }
  }

  return (
    <div id="sheet" className="open" role="dialog" aria-modal="true" aria-label="Saisie oubliée" onClick={(e) => e.target === e.currentTarget && onFermer()}>
      <div className="pad correction">
        <h3>{type === "releve" ? "Relevé oublié" : "Mesure d'huile oubliée"} · {jourLong(jour)}</h3>
        <p className="hint">Elle sera enregistrée à l'heure indiquée, signalée « saisie après coup par le siège » avec votre nom et le motif. La tâche manquée reste manquée.</p>
        <label className="champ-bloc">{type === "releve" ? "Enceinte" : "Friteuse"}
          <select className="champ" value={equipement} onChange={(e) => { setEquipement(e.target.value); setAction(null); }}>
            {eq.map((x) => <option key={x.id} value={x.id}>{x.nom}{x.t_max !== undefined ? ` (max ${deg(x.t_max)})` : ""}</option>)}
          </select>
        </label>
        <label className="champ-bloc">Heure à laquelle elle a été faite
          <input className="champ" type="time" value={heureSaisie} onChange={(e) => setHeureSaisie(e.target.value)} />
          {futur && <span className="t-bad">Cette heure n'est pas encore passée.</span>}
        </label>
        <label className="champ-bloc">{type === "releve" ? "Température (°C)" : "Composés polaires (%)"}
          <input className="champ" inputMode="decimal" value={valeur} onChange={(e) => setValeur(e.target.value)} />
          {v !== null && valeurKo && <span className="t-bad">{bornes?.message ?? "Valeur invalide."}</span>}
        </label>
        {horsSeuil && (
          <div className="champ-bloc">Hors seuil : action corrective faite à l'époque (obligatoire)
            <span className="opts">{ACTIONS_RELEVE.map((x) => <button key={x} type="button" className={`opt ${action === x ? "sel" : ""}`} onClick={() => setAction(x)}>{x}</button>)}</span>
          </div>
        )}
        {type === "huile" && (
          <div className="champ-bloc">Huile filtrée ou changée ? (obligatoire)
            <span className="opts">
              {!rouge && <button type="button" className={`opt ${decision === "filtree" ? "sel" : ""}`} onClick={() => setDecision("filtree")}>Huile filtrée</button>}
              <button type="button" className={`opt ${decision === "changee" ? "sel" : ""}`} onClick={() => setDecision("changee")}>Huile changée</button>
            </span>
          </div>
        )}
        <label className="champ-bloc">Motif (obligatoire)
          <span className="opts">{MOTIFS_OUBLI.map((m) => <button key={m} type="button" className={`opt ${motif === m ? "sel" : ""}`} onClick={() => setMotif(m)}>{m}</button>)}</span>
          <input className="champ" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="Ou écrivez le motif" />
        </label>
        {erreur && <p className="pill bad">{erreur}</p>}
        <div className="carte-actions">
          <button className="opt" onClick={onFermer}>Annuler</button>
          <button className="s3-verifier" disabled={!possible} onClick={valider}>{envoi ? "Enregistrement…" : "Enregistrer la saisie oubliée"}</button>
        </div>
      </div>
    </div>
  );
}
