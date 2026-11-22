import type { ClasseurSite, DocumentSaisie, TypeDocument, AnalyseSaisie, EtatVisites, Visite, VisiteSaisie, ActionPlan, AppareilMesure, ControleSite, ModeleControle, ElementATaire, ElementNettoyage, ProduitEntretien, TacheNettoyage, AlerteSiege, ReponseAlerte, Api, Anomalie, AnomalieSiege, Correction, DecisionStock, Employe, EnceinteGestion, FournisseurGestion, FriteuseGestion, ModeleTache, SiteGestion, Tablette, EtatStock, LivraisonJour, Rattrapage, EtatRestaurant, EtatFriteuse, Preuves, Profil, Tache } from "../types";
import { ErreurDefinitive, type Operation } from "../operations";
import { lectureConforme, transitionPermise } from "../logique";

/** Serveur simulé en mémoire : sert au développement et aux démonstrations, rien n'est conservé. */
const MIN = 60_000;
const t0 = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const PINS: Record<string, string> = { p1: "1234", p2: "1111", p3: "2222", p4: "3333" };

const profils: Profil[] = [
  { id: "p1", nom: "Karim", role: "chef" },
  { id: "p2", nom: "Julie", role: "equipe" },
  { id: "p3", nom: "Mehdi", role: "equipe" },
  { id: "p4", nom: "Thomas", role: "responsable" },
];
const taches: Tache[] = [
  { id: "t1", type: "releves", titre: "Relevé températures du matin", echeance: iso(t0 - 25 * MIN), faite_at: null, faite_par_nom: null, escalade: 0 },
  { id: "t2", type: "huile", titre: "Mesure de l'huile", echeance: iso(t0 + 10 * MIN), faite_at: null, faite_par_nom: null, escalade: 0 },
  { id: "t3", type: "dlc", titre: "Tour des DLC", echeance: iso(t0 - 150 * MIN), faite_at: iso(t0 - 140 * MIN), faite_par_nom: "Karim", escalade: 0 },
  { id: "t4", type: "autre", titre: "Contrôle des pièges à nuisibles", echeance: iso(t0 + 180 * MIN), faite_at: null, faite_par_nom: null, escalade: 0 },
  { id: "t6", type: "nettoyage", titre: "Nettoyage cuisine", echeance: iso(t0 + 60 * MIN), faite_at: null, faite_par_nom: null, escalade: 0 },
  { id: "t7", type: "nettoyage", titre: "Nettoyage sanitaires", echeance: iso(t0 + 240 * MIN), faite_at: null, faite_par_nom: null, escalade: 0 },
  { id: "t5", type: "releves", titre: "Relevé températures du soir", echeance: iso(t0 + 390 * MIN), faite_at: null, faite_par_nom: null, escalade: 0 },
];
type AnomalieDemo = Anomalie & Partial<Pick<ActionPlan, "action_prevue" | "echeance" | "responsable_id" | "preuve" | "traitee_commentaire" | "photo" | "source">>;
const anomalies: AnomalieDemo[] = [
  { id: "a1", titre: "Joint de porte abîmé · chambre froide positive", categorie: "Matériel", gravite: "mineure", statut: "ouverte", cree_at: iso(t0 - 26 * 60 * MIN) },
  { id: "a2", titre: "Moustiquaires : moustiquaire de la réserve déchirée", categorie: "Nuisibles", gravite: "majeure", statut: "ouverte", cree_at: iso(t0 - 9 * 24 * 60 * MIN),
    source: "controle", action_prevue: "Commander une moustiquaire sur mesure", echeance: new Date(t0 - 2 * 24 * 60 * MIN).toLocaleDateString("sv-SE"), responsable_id: "p4" },
];
const SITES_DEMO = [
  ["ATLANTA", "LANGUEUX"], ["BOSTON", "RENNES"], ["COLUMBIA", "BRÉTIGNY-SUR-ORGE"], ["DALLAS", "CHAMBRAY"],
  ["ELVIS AND CO", "TOURS"], ["MIAMI'S", "DIJON"], ["NEW-YORK", "ARRAS"], ["PHILADELPHIE", "LES CLAYES-SOUS-BOIS"],
  ["PHOENIX", "SARAN"], ["SITE 10", "À COMPLÉTER"], ["SITE 11", "À COMPLÉTER"], ["SITE 12", "À COMPLÉTER"],
  ["SITE 13", "À COMPLÉTER"], ["SITE 14", "À COMPLÉTER"], ["SITE 15", "À COMPLÉTER"],
];
/** Huile des friteuses de démo : jours déjà utilisés (F2 bientôt au maximum, F3 au-delà de 14 j). */
const JOUR = 24 * 60 * MIN;
const etatHuile: EtatFriteuse[] = [
  { friteuse_id: "f1", jours_utilisation: 5, dernier_changement: iso(t0 - 5 * JOUR), aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null },
  { friteuse_id: "f2", jours_utilisation: 12, dernier_changement: iso(t0 - 13 * JOUR), aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null },
  { friteuse_id: "f3", jours_utilisation: 14, dernier_changement: iso(t0 - 16 * JOUR), aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null },
  { friteuse_id: "f4", jours_utilisation: 2, dernier_changement: iso(t0 - 3 * JOUR), aujourd_hui_at: null, aujourd_hui_polaires: null, aujourd_hui_non_utilisee: null },
];
/** Stocks morts de la démo : produits retirés de la carte, et réponses par restaurant (la tablette de démo = DALLAS, s3). */
type InvDemo = { site_id: string; reste: boolean; quantite: string | null; dlc: string | null; photo: string | null; decision: DecisionStock | null; transfert_vers: string | null; par: string; at: string };
const produitsDemo: { id: string; nom: string; fournisseur: string | null; consigne: string | null; sortie_le: string; actif: boolean; inv: InvDemo[] }[] = [
  { id: "pr1", nom: "Sauce cheddar ancienne recette", fournisseur: "SYSCO", consigne: "À écouler en plat du jour, sinon à jeter avant le 30/11", sortie_le: iso(t0 - 5 * 24 * 60 * MIN).slice(0, 10), actif: true,
    inv: [{ site_id: "s0", reste: true, quantite: "2 bidons", dlc: "2026-11-28", photo: "demo/s1.webp", decision: "a_ecouler", transfert_vers: null, par: "Hugo", at: iso(t0 - 3 * 24 * 60 * MIN) },
          { site_id: "s1", reste: false, quantite: null, dlc: null, photo: null, decision: null, transfert_vers: null, par: "Léa", at: iso(t0 - 4 * 24 * 60 * MIN) }] },
];
const etatInv = (i?: InvDemo): EtatStock => (!i ? "a_verifier" : !i.reste || i.decision === "jete" || i.decision === "transfere" ? "solde" : "a_ecouler");
/** Espace PMS en démo : contrôles périodiques et sondes de DALLAS. */
const jourDemo = (j: number) => new Date(t0 + j * 24 * 60 * MIN).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const ajoutMois = (d: string, m: number) => { const x = new Date(`${d}T12:00:00`); x.setMonth(x.getMonth() + m); return x.toLocaleDateString("sv-SE"); };
const modelesDemo: ModeleControle[] = ([
  ["entretien", "Nettoyage des condenseurs des groupes froids", "Couper le groupe, brosser et aspirer les ailettes", 3, "photo", false],
  ["entretien", "Hotte et conduits d'extraction : dégraissage complet", "Par une entreprise spécialisée ; garder le certificat", 6, "document", true],
  ["entretien", "Joints des portes des enceintes froides", "Joints entiers, souples, sans moisissure", 1, "aucune", false],
  ["nuisibles", "Passage du prestataire de dératisation et désinsectisation", "Joindre le rapport de passage", 3, "document", true],
  ["nuisibles", "Moustiquaires", "Présentes sur les ouvrants, sans trou, propres", 1, "aucune", false],
] as const).map(([rubrique, titre, methode, periodicite_mois, preuve, prestataire], i) => ({
  id: `cm${i + 1}`, rubrique, titre, methode, periodicite_mois, preuve, prestataire, sites: null, ordre: i, actif: true }));
const controlesFaitsDemo: { site: string; modele: string; date: string; conforme: boolean; observation: string | null; prestataire: string | null; photo: string | null; document: string | null; par: string }[] = [
  { site: "s3", modele: "cm1", date: jourDemo(-100), conforme: true, observation: null, prestataire: null, photo: "demo/s1.webp", document: null, par: "Karim" },
  { site: "s3", modele: "cm2", date: jourDemo(-60), conforme: true, observation: null, prestataire: "Hotte Service", photo: "demo/s2.webp", document: null, par: "Thomas" },
  { site: "s3", modele: "cm3", date: jourDemo(-10), conforme: true, observation: null, prestataire: null, photo: null, document: null, par: "Karim" },
  { site: "s3", modele: "cm5", date: jourDemo(-9), conforme: false, observation: "moustiquaire de la réserve déchirée", prestataire: null, photo: "demo/s1.webp", document: null, par: "Karim" },
];
function etatControlesDemo(site: string): ControleSite[] {
  const auj = jourDemo(0), dans15 = jourDemo(15);
  return modelesDemo.filter((m) => m.actif).map((m) => {
    const d = controlesFaitsDemo.filter((f) => f.site === site && f.modele === m.id).sort((a, b) => b.date.localeCompare(a.date))[0];
    const prochaine = d ? ajoutMois(d.date, m.periodicite_mois) : null;
    return { id: m.id!, rubrique: m.rubrique, titre: m.titre, methode: m.methode, periodicite_mois: m.periodicite_mois, preuve: m.preuve, prestataire: m.prestataire,
      dernier: d ? { date: d.date, conforme: d.conforme, observation: d.observation, prestataire: d.prestataire, photo: d.photo, document: d.document, par: d.par } : null,
      prochaine, etat: !prochaine ? "jamais" : prochaine < auj ? "retard" : prochaine <= dans15 ? "bientot" : "a_jour" };
  });
}
const appareilsDemo: (Omit<AppareilMesure, "etat" | "prochaine">)[] = [
  { id: "am1", nom: "Sonde piquante cuisine", type: "sonde", numero: "TS-0412", hors_service: false,
    dernier: { date: jourDemo(-200), methode: "glace", valeur: 0.2, conforme: true, photo: "demo/s1.webp", document: null, par: "Karim" } },
  { id: "am2", nom: "Thermomètre infrarouge livraisons", type: "infrarouge", numero: null, hors_service: false, dernier: null },
];
function etatMetrologieDemo(): AppareilMesure[] {
  const auj = jourDemo(0), dans30 = jourDemo(30);
  return appareilsDemo.map((a) => {
    const prochaine = a.dernier ? ajoutMois(a.dernier.date, 12) : null;
    return { ...a, prochaine, etat: a.hors_service ? "hors_service" : !prochaine ? "jamais" : prochaine < auj ? "retard" : prochaine <= dans30 ? "bientot" : "a_jour" };
  });
}
const visitesDemo: Visite[] = [
  { id: "vi1", type: "eurofins", date_visite: jourDemo(-75), organisme: "Eurofins", intervenant: "M. Leroy", note: 84, niveau: "satisfaisant", rapport: "demo/s2.webp",
    commentaire: null, par: "Siège", ecarts: [{ id: "a2", titre: "Moustiquaires : moustiquaire de la réserve déchirée", gravite: "majeure", statut: "ouverte" }],
    analyses: [
      { id: "an1", date_prelevement: jourDemo(-75), categorie: "surface", objet: "Plan de travail poste froid", resultat: "satisfaisant", detail: null, rapport: "demo/s2.webp" },
      { id: "an2", date_prelevement: jourDemo(-75), categorie: "produit", objet: "Coleslaw maison", resultat: "acceptable", detail: "Flore totale 2.10⁵ ufc/g", rapport: "demo/s2.webp" }] },
  { id: "vi2", type: "officielle", date_visite: jourDemo(-200), organisme: "DDPP", intervenant: null, note: null, niveau: "satisfaisant", rapport: null,
    commentaire: "Alim'confiance : satisfaisant", par: "Karim", ecarts: [], analyses: [] },
];
function etatVisitesDemo(): EtatVisites {
  const der = visitesDemo.filter((v) => v.type === "eurofins").map((v) => v.date_visite).sort().pop() ?? null;
  const prochaine = der ? ajoutMois(der, 2) : null;
  return { eurofins_mois: 2, derniere_eurofins: der, prochaine_eurofins: prochaine,
    etat_eurofins: !prochaine ? "jamais" : prochaine < jourDemo(0) ? "retard" : prochaine <= jourDemo(15) ? "bientot" : "a_jour",
    visites: [...visitesDemo].sort((a, b) => b.date_visite.localeCompare(a.date_visite)) };
}
function ajouterVisiteDemo(v: VisiteSaisie, rapport: string | null, par: string) {
  if (visitesDemo.some((x) => x.id === v.id)) return;
  const ecarts = v.ecarts.filter((e) => e.texte.trim().length >= 3).map((e, i) => {
    const id = `av-${v.id}-${i}`;
    anomalies.unshift({ id, titre: e.texte.trim(), categorie: v.type === "eurofins" ? "Visite Eurofins" : "Visite officielle", gravite: e.gravite, statut: "ouverte", cree_at: iso(Date.now()), source: "visite" });
    return { id, titre: e.texte.trim(), gravite: e.gravite, statut: "ouverte" as const };
  });
  visitesDemo.push({ id: v.id, type: v.type, date_visite: v.date_visite, organisme: v.organisme ?? null, intervenant: v.intervenant ?? null, note: v.note ?? null,
    niveau: v.niveau ?? null, rapport, commentaire: v.commentaire ?? null, par, ecarts, analyses: [] });
  ajouterAnalysesDemo(v.id, v.analyses, rapport);
}
function ajouterAnalysesDemo(visiteId: string, l: AnalyseSaisie[], rapport: string | null) {
  const v = visitesDemo.find((x) => x.id === visiteId);
  if (!v) return;
  for (const a of l) {
    if (v.analyses.some((x) => x.id === a.id)) continue;
    v.analyses.push({ id: a.id, date_prelevement: a.date_prelevement ?? v.date_visite, categorie: a.categorie, objet: a.objet, resultat: a.resultat, detail: a.detail ?? null, rapport });
    if (a.resultat === "non_satisfaisant") anomalies.unshift({ id: `aa-${a.id}`, titre: `Analyse non satisfaisante : ${a.objet}${a.detail ? ` (${a.detail})` : ""}`,
      categorie: "Analyse bactériologique", gravite: "majeure", statut: "ouverte", cree_at: iso(Date.now()), source: "analyse" });
  }
}
const typesDocsDemo: TypeDocument[] = ([
  ["plan_haccp", "Plan HACCP et analyse des dangers", "haccp", "groupe", true, false], ["procedures", "Procédures et bonnes pratiques d'hygiène", "haccp", "groupe", true, false],
  ["tracabilite", "Procédure de traçabilité et de retrait-rappel", "haccp", "groupe", true, false],
  ["formation_hygiene", "Attestation de formation à l'hygiène alimentaire", "formation", "site", true, false],
  ["declaration_ddpp", "Déclaration d'activité ou agrément (DDPP)", "administratif", "site", true, false],
  ["contrat_3d", "Contrat de dératisation et désinsectisation", "nuisibles", "site", true, true], ["plan_appats", "Plan de positionnement des appâts", "nuisibles", "site", true, false],
  ["contrat_eurofins", "Contrat avec le laboratoire (Eurofins)", "contrats", "groupe", true, true], ["contrat_hotte", "Contrat d'entretien de la hotte et des conduits", "contrats", "site", false, true],
  ["autre", "Autre document", "autre", "site", false, false],
] as const).map(([cle, libelle, rubrique, niveau, obligatoire, expire], i) => ({ cle, libelle, rubrique, niveau, obligatoire, expire, ordre: i }));
type DocDemo = { id: string; site: string | null; type_cle: string; titre: string; fichier: string; expire_le: string | null; personne: string | null; par: string; at: string; actif: boolean; archive_at: string | null };
const docsDemo: DocDemo[] = [
  { id: "d1", site: null, type_cle: "plan_haccp", titre: "Plan HACCP groupe 2026", fichier: "demo/s2.webp", expire_le: null, personne: null, par: "Siège", at: iso(t0 - 90 * 24 * 60 * MIN), actif: true, archive_at: null },
  { id: "d2", site: null, type_cle: "contrat_eurofins", titre: "Contrat Eurofins 2026", fichier: "demo/s2.webp", expire_le: jourDemo(200), personne: null, par: "Siège", at: iso(t0 - 200 * 24 * 60 * MIN), actif: true, archive_at: null },
  { id: "d3", site: "s3", type_cle: "contrat_3d", titre: "Contrat Rentokil", fichier: "demo/s1.webp", expire_le: jourDemo(12), personne: null, par: "Karim", at: iso(t0 - 340 * 24 * 60 * MIN), actif: true, archive_at: null },
  { id: "d4", site: "s3", type_cle: "formation_hygiene", titre: "Attestation formation hygiène", fichier: "demo/s1.webp", expire_le: null, personne: "Karim", par: "Karim", at: iso(t0 - 400 * 24 * 60 * MIN), actif: true, archive_at: null },
];
function classeurDemo(site: string): ClasseurSite {
  const auj = jourDemo(0), d30 = jourDemo(30);
  const vis = docsDemo.filter((d) => d.actif && (d.site === null || d.site === site));
  return {
    documents: vis.map((d) => { const t = typesDocsDemo.find((x) => x.cle === d.type_cle)!; return { id: d.id, groupe: d.site === null, type_cle: d.type_cle, type: t.libelle, rubrique: t.rubrique,
      titre: d.titre, fichier: d.fichier, expire_le: d.expire_le, personne: d.personne, par: d.par, at: d.at,
      etat: !d.expire_le ? "a_jour" as const : d.expire_le < auj ? "retard" as const : d.expire_le <= d30 ? "bientot" as const : "a_jour" as const }; }),
    attendus: typesDocsDemo.filter((t) => t.obligatoire).map((t) => ({ cle: t.cle, libelle: t.libelle, rubrique: t.rubrique, niveau: t.niveau,
      present: vis.some((d) => d.type_cle === t.cle && (!d.expire_le || d.expire_le >= auj)) })),
  };
}
function deposerDocDemo(site: string | null, d: DocumentSaisie, fichier: string, par: string) {
  if (docsDemo.some((x) => x.id === d.id)) return;
  if (d.remplace) { const a = docsDemo.find((x) => x.id === d.remplace); if (a) Object.assign(a, { actif: false, archive_at: iso(Date.now()) }); }
  docsDemo.push({ id: d.id, site, type_cle: d.type_cle, titre: d.titre, fichier, expire_le: d.expire_le ?? null, personne: d.personne ?? null, par, at: iso(Date.now()), actif: true, archive_at: null });
}
function planActionDemo(): ActionPlan[] {
  return anomalies.map((a) => ({ id: a.id, titre: a.titre, categorie: a.categorie, gravite: a.gravite, statut: a.statut, source: a.source ?? "manuel", cree_at: a.cree_at,
    photo: a.photo ?? null, action_prevue: a.action_prevue ?? null, echeance: a.echeance ?? null, responsable_id: a.responsable_id ?? null,
    responsable: profils.find((p) => p.id === a.responsable_id)?.nom ?? null, preuve: a.preuve ?? null,
    traitee_at: null, traitee_par: null, traitee_commentaire: a.traitee_commentaire ?? null, verifiee_at: null, verifiee_par: null }));
}
/** Plan de nettoyage en démo : produits, plan du groupe, tâches du jour de DALLAS. */
const entretienDemo: ProduitEntretien[] = [
  { id: "pe1", nom: "Détergent désinfectant surfaces", usage: "Plans de travail, ustensiles, frigos", dilution: "Prêt à l'emploi", temps_contact: "5 min", ft: "demo/s1.webp", fds: "demo/s2.webp", actif: true },
  { id: "pe2", nom: "Dégraissant cuisine", usage: "Hotte, filtres, plaques", dilution: "5 % : 50 mL pour 1 L", temps_contact: "10 min", ft: null, fds: "demo/s2.webp", actif: true },
  { id: "pe3", nom: "Désinfectant sanitaires", usage: "Toilettes, lavabos, poignées", dilution: "Prêt à l'emploi", temps_contact: "5 min", ft: null, fds: null, actif: true },
];
const planDemo: ElementNettoyage[] = [
  ["Cuisine", "Plans de travail et surfaces", "jour", null, "15:30:00", "pe1", "Débarrasser, pulvériser, laisser agir, rincer", false, 1],
  ["Cuisine", "Plaque de cuisson et grill", "jour", null, "15:30:00", "pe2", "Racler à chaud, dégraisser à froid, rincer", true, 2],
  ["Cuisine", "Sol de la cuisine", "jour", null, "15:30:00", null, null, false, 3],
  ["Cuisine", "Hotte et filtres", "semaine", 5, "23:30:00", "pe2", "Filtres démontés, trempage, rinçage", true, 4],
  ["Sanitaires", "Sanitaires clients et personnel", "jour", null, "23:30:00", "pe3", null, true, 1],
  ["Salle", "Vitres et portes vitrées", "mois", 1, "15:30:00", null, null, false, 1],
].map(([zone, element, frequence, jour, heure_limite, produit_id, methode, photo_obligatoire, ordre], i) => ({
  id: `ne${i + 1}`, zone, element, frequence, jour, heure_limite, produit_id, methode, photo_obligatoire, sites: null, ordre, actif: true,
}) as ElementNettoyage);
const faitsDemo = new Map<string, { par: string | null; at: string; photo: string | null }>([["t6:ne1", { par: "Julie", at: iso(t0 - 20 * MIN), photo: null }]]);
function tachesNettoyageDemo(): TacheNettoyage[] {
  const el = (tache: string, id: string): ElementATaire => {
    const e = planDemo.find((x) => x.id === id)!, p = entretienDemo.find((x) => x.id === e.produit_id);
    return { id, zone: e.zone, element: e.element, methode: e.methode, photo_obligatoire: e.photo_obligatoire,
      produit: p ? { id: p.id!, nom: p.nom, dilution: p.dilution, temps_contact: p.temps_contact, ft: p.ft, fds: p.fds } : null,
      fait: faitsDemo.get(`${tache}:${id}`) ?? null };
  };
  return [
    { tache_id: "t6", zone: "Cuisine", echeance: taches.find((t) => t.id === "t6")!.echeance, elements: ["ne1", "ne2", "ne3"].map((x) => el("t6", x)) },
    { tache_id: "t7", zone: "Sanitaires", echeance: taches.find((t) => t.id === "t7")!.echeance, elements: [el("t7", "ne5")] },
  ];
}
/** Alertes produit en démo : un retrait du fournisseur à vérifier, une prolongation de DDM déjà traitée à DALLAS (s3). */
type RepDemo = ReponseAlerte & { site_id: string };
const alertesDemo: (Omit<AlerteSiege, "sites"> & { cible: string[] | null; reps: RepDemo[] })[] = [
  { id: "al1", type: "retrait", produit: "Cheddar tranché 1 kg", fournisseur: "SYSCO", lots: "L2611A, L2611B", ddm_origine: null, ddm_nouvelle: null,
    consigne: "Isoler, étiqueter « NE PAS UTILISER », le fournisseur repasse le reprendre", document: "demo/s1.webp", document_type: "image/webp",
    cree_at: iso(t0 - 90 * MIN), echeance: iso(t0 + 150 * MIN), clos_at: null, cible: null,
    reps: [{ site_id: "s0", trouve: false, lot: null, quantite: null, action: null, at: iso(t0 - 60 * MIN), par: "Hugo" }] },
  { id: "al2", type: "prolongation", produit: "Sauce barbecue 2 L", fournisseur: "EPISAVEURS", lots: "B4471", ddm_origine: iso(t0 + 3 * 24 * 60 * MIN).slice(0, 10),
    ddm_nouvelle: iso(t0 + 63 * 24 * 60 * MIN).slice(0, 10), consigne: null, document: "demo/s2.webp", document_type: "image/webp",
    cree_at: iso(t0 - 26 * 60 * MIN), echeance: iso(t0 - 2 * 60 * MIN), clos_at: null, cible: null,
    reps: [{ site_id: "s3", trouve: true, lot: "B4471", quantite: "4 bidons", action: "reetiquete", photo: "demo/s1.webp", photo_action: "demo/s2.webp", at: iso(t0 - 20 * 60 * MIN), par: "Karim" }] },
];
/** Gestion siège en démo : paramétrage en mémoire. */
const gestion = {
  sites: SITES_DEMO.map(([nom, ville], i) => ({ id: `s${i}`, nom, ville, ouverture: "09:00:00", service_soir: "18:45:00", actif: true })) as SiteGestion[],
  ref: new Map<string, { enceintes: EnceinteGestion[]; friteuses: FriteuseGestion[]; modeles: ModeleTache[] }>(),
  employes: new Map<string, Employe[]>(),
  tablettes: [] as Tablette[],
  fournisseurs: null as FournisseurGestion[] | null,
  n: 0,
};
function refDemo(site: string) {
  if (!gestion.ref.has(site)) {
    const e = (nom: string, t: number, o: number): EnceinteGestion => ({ id: `${site}-e${o}`, site_id: site, nom, t_max: t, ordre: o, actif: true });
    gestion.ref.set(site, {
      enceintes: [e("Chambre froide positive", 3, 1), e("Chambre froide négative", -18, 2), e("Frigo poste chaud", 4, 3), e("Frigo poste froid", 4, 4)],
      friteuses: [1, 2].map((k) => ({ id: `${site}-f${k}`, site_id: site, nom: `Friteuse ${k}`, litres: 25, actif: true })),
      modeles: [["releves", "Relevé températures du matin", "11:00:00", [1, 2, 3, 4, 5, 6, 7]], ["huile", "Mesure de l'huile", "11:30:00", [1, 2, 3, 4, 5, 6, 7]],
        ["releves", "Relevé températures du soir", "18:00:00", [1, 2, 3, 4, 5, 6, 7]], ["dlc", "Tour des DLC", "10:30:00", [1]], ["nettoyage", "Nettoyage hottes et filtres", "23:00:00", [5]]]
        .map(([type, titre, h, j], k) => ({ id: `${site}-m${k}`, site_id: site, type: type as string, titre: titre as string, heure_limite: h as string, jours: j as number[], actif: true })),
    });
  }
  return gestion.ref.get(site)!;
}
const pinDemo = () => String(1000 + Math.floor(Math.random() * 9000));
/** Livraisons reçues pendant la démo. */
const livraisonsDemo: LivraisonJour[] = [];
/** Saisies oubliées ajoutées par le siège pendant la démo. */
const rattrapagesDemo: Rattrapage[] = [];
/** Corrections faites par le siège pendant la démo (par id de saisie). */
const correctionsDemo = new Map<string, Correction>();
/** Anomalies du groupe vues par le siège (démo). */
const anomaliesGroupe: AnomalieSiege[] = [
  { id: "g1", site_id: "s3", restaurant: "DALLAS", titre: "Chambre froide négative à −12 °C (max −18 °C) · denrées déplacées", categorie: "Température", gravite: "critique", statut: "ouverte", cree_at: iso(t0 - 3 * 60 * MIN), cree_par: "Karim", traitee_at: null, traitee_par: null, traitee_commentaire: null, verifiee_at: null, verifiee_par: null, photo: null },
  { id: "g2", site_id: "s1", restaurant: "BOSTON", titre: "Friteuse 2 : huile utilisée depuis 16 jours (max 14)", categorie: "Huile", gravite: "majeure", statut: "traitee", cree_at: iso(t0 - 20 * 60 * MIN), cree_par: "Léa", traitee_at: iso(t0 - 18 * 60 * MIN), traitee_par: "Léa", traitee_commentaire: "Huile changée avant le service du soir", verifiee_at: null, verifiee_par: null, photo: null },
  { id: "g3", site_id: "s6", restaurant: "NEW-YORK", titre: "Tâche non faite : Relevé températures du soir", categorie: "Tâche", gravite: "majeure", statut: "ouverte", cree_at: iso(t0 - 30 * 60 * MIN), cree_par: null, traitee_at: null, traitee_par: null, traitee_commentaire: null, verifiee_at: null, verifiee_par: null, photo: null },
  { id: "g4", site_id: "s0", restaurant: "ATLANTA", titre: "Livraison Pomona : camion à +9 °C · produits refusés", categorie: "Livraison", gravite: "majeure", statut: "verifiee", cree_at: iso(t0 - 50 * 60 * MIN), cree_par: "Hugo", traitee_at: iso(t0 - 49 * 60 * MIN), traitee_par: "Hugo", traitee_commentaire: "Avoir demandé au fournisseur", verifiee_at: iso(t0 - 26 * 60 * MIN), verifiee_par: "Siège (démo)", photo: null },
];
/** Ce que le serveur simulé a reçu (identifiants déjà vus : un envoi rejoué est ignoré, comme sur le vrai serveur). */
export const recuDemo = { ids: new Set<string>(), photos: new Map<string, Blob>(), livraisons: 0, utilisations: 0 };
const attendre = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 80));

/** Pour les démonstrations et les tests : simule une coupure réseau (window.__demoHorsLigne = true). */
function horsLigne(): boolean { return typeof window !== "undefined" && (window as unknown as { __demoHorsLigne?: boolean }).__demoHorsLigne === true; }

export const demoApi: Api = {
  mode: "demo",
  estActivee: () => attendre(true),
  activer: async () => {},
  site: () => attendre({ id: "s1", nom: "DALLAS", ville: "CHAMBRAY" }),
  profils: () => attendre(profils),
  verifierPin: (id, pin) => attendre(PINS[id] === pin),
  taches: () => attendre(taches.map((t) => ({ ...t }))),
  enceintes: () => attendre([
    { id: "e1", nom: "Chambre froide positive", t_max: 3 },
    { id: "e2", nom: "Chambre froide négative", t_max: -18 },
    { id: "e3", nom: "Frigo poste chaud", t_max: 4 },
    { id: "e4", nom: "Frigo poste froid", t_max: 4 },
    { id: "e5", nom: "Frigo desserts", t_max: 4 },
    { id: "e6", nom: "Congélateur poste froid", t_max: -18 },
  ]),
  friteuses: () => attendre([1, 2, 3, 4].map((i) => ({ id: `f${i}`, nom: `Friteuse ${i}`, litres: 25 }))),
  seuilsHuile: () => attendre({ orange: 20, rouge: 25, jours_max: 14 }),
  etatFriteuses: () => attendre(etatHuile.map((e) => ({ ...e }))),
  fournisseurs: () => {
    const tous = [1, 2, 3, 4, 5, 6, 7];
    return attendre([
      { id: "fo0", nom: "Transgourmet", viande: true, jours: tous }, { id: "fo1", nom: "Pomona", viande: false, jours: tous, produits: ["frais"] },
      { id: "fo2", nom: "Metro", viande: true, jours: [] }, { id: "fo3", nom: "Brake", viande: false, jours: [], produits: ["surgele"] },
      { id: "fo4", nom: "Boucherie (viandes)", viande: true, jours: [] }, { id: "fo5", nom: "Cafés (sec)", viande: false, jours: [], produits: ["sec"] },
    ]);
  },
  livraisonsDuJour: () => attendre(livraisonsDemo.map((l) => ({ ...l }))),
  stocksMortsDuSite: () => attendre(produitsDemo.filter((p) => p.actif).map((p) => {
    const i = p.inv.filter((x) => x.site_id === "s3").slice(-1)[0];
    const etat = etatInv(i);
    return { produit_id: p.id, nom: p.nom, fournisseur: p.fournisseur, consigne: p.consigne, sortie_le: p.sortie_le, etat,
      quantite: i?.quantite ?? null, dlc: i?.dlc ?? null, verifie_at: i?.at ?? null,
      a_faire: !i || (etat === "a_ecouler" && (Date.now() - Date.parse(i.at) > 7 * 24 * 60 * MIN || (!!i.dlc && i.dlc <= new Date().toISOString().slice(0, 10)))) };
  })),
  stocksMortsSiege: () => attendre(produitsDemo.map((p) => ({
    id: p.id, nom: p.nom, fournisseur: p.fournisseur, consigne: p.consigne, sortie_le: p.sortie_le, actif: p.actif,
    sites: SITES_DEMO.map(([nom], k) => {
      const i = p.inv.filter((x) => x.site_id === `s${k}`).slice(-1)[0];
      return { site_id: `s${k}`, restaurant: nom, etat: etatInv(i), quantite: i?.quantite ?? null, dlc: i?.dlc ?? null, photo: i?.photo ?? null,
        decision: i?.decision ?? null, transfert_vers: i?.transfert_vers ?? null, par: i?.par ?? null, at: i?.at ?? null };
    }),
  }))),
  siegeRetirerProduit: async (nom, fournisseurId, consigne) => {
    if (nom.trim().length < 2) throw new Error("Nom du produit obligatoire");
    produitsDemo.unshift({ id: `pr${produitsDemo.length + 1}`, nom: nom.trim(), fournisseur: fournisseurId ? "Fournisseur" : null,
      consigne: consigne.trim() || null, sortie_le: new Date().toISOString().slice(0, 10), actif: true, inv: [] });
  },
  planAction: () => attendre(planActionDemo()),
  etatControles: (site) => attendre(etatControlesDemo(site === "s1" ? "s3" : site)),
  etatMetrologie: () => attendre(etatMetrologieDemo()),
  ajouterAppareil: async (_p, nom, type, numero) => {
    if (nom.trim().length < 2) throw new Error("Nom obligatoire");
    appareilsDemo.push({ id: `am${appareilsDemo.length + 1}`, nom: nom.trim(), type, numero: numero.trim() || null, hors_service: false, dernier: null });
  },
  typesDocuments: () => attendre(typesDocsDemo.map((x) => ({ ...x }))),
  documentsSite: (site) => attendre(classeurDemo(site === "s1" ? "s3" : site ?? "__groupe__")),
  documentsArchives: (site) => attendre(docsDemo.filter((d) => !d.actif && (d.site === null || d.site === (site === "s1" ? "s3" : site ?? "__groupe__"))).map((d) => ({
    id: d.id, groupe: d.site === null, type: typesDocsDemo.find((t) => t.cle === d.type_cle)!.libelle, titre: d.titre, fichier: d.fichier, expire_le: d.expire_le,
    personne: d.personne, at: d.at, archive_at: d.archive_at! }))),
  documentsGroupe: () => attendre(SITES_DEMO.map((_, k) => { const c = classeurDemo(`s${k}`);
    return { site_id: `s${k}`, manquants: c.attendus.filter((a) => !a.present).length, expires: c.documents.filter((d) => d.etat === "retard").length, bientot: c.documents.filter((d) => d.etat === "bientot").length }; })),
  siegeEnregistrerDocument: async (site, d) => deposerDocDemo(site, d, "demo/s2.webp", "Siège"),
  siegeArchiverDocument: async (id) => { const a = docsDemo.find((x) => x.id === id); if (a) Object.assign(a, { actif: false, archive_at: iso(Date.now()) }); },
  etatVisites: () => attendre(etatVisitesDemo()),
  siegeEnregistrerVisite: async (_site, v, rapport) => ajouterVisiteDemo(v, rapport ? "demo/s2.webp" : null, "Siège"),
  siegeAjouterAnalyses: async (id, l, rapport) => ajouterAnalysesDemo(id, l, rapport ? "demo/s2.webp" : null),
  pmsGroupe: () => attendre(SITES_DEMO.map(([nom], k) => ({ site_id: `s${k}`, restaurant: nom,
    visites: k === 3 ? (({ visites: _v, ...e }) => e)(etatVisitesDemo())
      : { eurofins_mois: 2, derniere_eurofins: jourDemo(-20 - 9 * k), prochaine_eurofins: ajoutMois(jourDemo(-20 - 9 * k), 2),
          etat_eurofins: ajoutMois(jourDemo(-20 - 9 * k), 2) < jourDemo(0) ? "retard" as const : "a_jour" as const },
    derniere_visite: { type: "eurofins" as const, date_visite: k === 3 ? jourDemo(-75) : jourDemo(-20 - 9 * k), note: k === 3 ? 84 : 70 + (k * 7) % 28, niveau: null },
    analyses_non_satisfaisantes: k === 6 ? 1 : 0,
    controles: k === 3 ? etatControlesDemo("s3") : etatControlesDemo(`s${k}`).map((c, i) => (k % 3 === 0 || i > 2 ? c : { ...c, etat: "a_jour" as const, prochaine: jourDemo(40) })),
    metrologie: k === 3 ? etatMetrologieDemo() : [],
    actions_ouvertes: k === 3 ? anomalies.filter((a) => a.statut !== "verifiee").length : k % 4, actions_en_retard: k === 3 ? 1 : k % 5 === 0 ? 1 : 0, actions_sans_plan: k % 2 }))),
  modelesControles: () => attendre(modelesDemo.map((x) => ({ ...x }))),
  siegePlanifierAction: async (id, action, echeance, resp) => { const a = anomalies.find((x) => x.id === id); if (a) Object.assign(a, { action_prevue: action, echeance, responsable_id: resp }); },
  siegeEnregistrerControle: async (site, modele, date, conforme, observation, prestataire, document) => {
    controlesFaitsDemo.push({ site, modele, date, conforme, observation: observation || null, prestataire: prestataire || null, photo: null, document: document ? "demo/s2.webp" : null, par: "Siège" });
  },
  nettoyageDuJour: () => attendre(tachesNettoyageDemo()),
  produitsEntretien: () => attendre(entretienDemo.map((x) => ({ ...x }))),
  planNettoyage: () => attendre(planDemo.map((x) => ({ ...x }))),
  nettoyageSiege: () => attendre(SITES_DEMO.map(([nom], k) => ({
    site_id: `s${k}`, restaurant: nom,
    taches: k === 3 ? tachesNettoyageDemo().map((t) => ({ id: t.tache_id, zone: t.zone, echeance: t.echeance, faite_at: taches.find((x) => x.id === t.tache_id)!.faite_at,
      total: t.elements.length, faits: t.elements.filter((e) => e.fait).length,
      photos: t.elements.filter((e) => e.fait?.photo).map((e) => ({ element: e.element, photo: e.fait!.photo!, par: e.fait!.par, at: e.fait!.at })) }))
      : [{ id: `x${k}a`, zone: "Cuisine", echeance: iso(t0 + 60 * MIN), faite_at: k % 4 === 0 ? iso(t0 - 10 * MIN) : null, total: 3, faits: k % 4 === 0 ? 3 : k % 3,
           photos: k % 4 === 0 ? [{ element: "Plaque de cuisson et grill", photo: "demo/s1.webp", par: "Hugo", at: iso(t0 - 12 * MIN) }] : [] },
         { id: `x${k}b`, zone: "Sanitaires", echeance: iso(t0 + 240 * MIN), faite_at: null, total: 1, faits: 0, photos: [] }],
  }))),
  siegeDeposerDocument: async () => "demo/s2.webp",
  alertesDuSite: () => attendre(alertesDemo.filter((a) => !a.clos_at && (!a.cible || a.cible.includes("s3"))).map(({ cible: _c, reps, clos_at: _x, ...a }) => ({
    ...a, reponses: reps.filter((r) => r.site_id === "s3").map(({ site_id: _s, ...r }) => r) }))),
  alertesSiege: () => attendre(alertesDemo.map(({ cible, reps, ...a }) => ({
    ...a, sites: SITES_DEMO.map(([nom], k) => ({ site_id: `s${k}`, restaurant: nom, reponses: reps.filter((r) => r.site_id === `s${k}`).map(({ site_id: _s, ...r }) => r) }))
      .filter((x) => !cible || cible.includes(x.site_id)) }))),
  siegeCreerAlerte: async (a) => {
    if (a.produit.trim().length < 2) throw new Error("Nom du produit obligatoire");
    if (a.type === "prolongation" && !a.date_est_ddm) throw new Error("Une DLC ne peut pas être prolongée : seule une DDM peut l'être");
    const id = `al${alertesDemo.length + 1}`, h = a.type === "retrait" ? 4 : 24;
    alertesDemo.unshift({ id, type: a.type, produit: a.produit.trim(), fournisseur: a.fournisseur_id ? "Fournisseur" : null, lots: a.lots.trim() || null,
      ddm_origine: a.ddm_origine, ddm_nouvelle: a.ddm_nouvelle, consigne: a.consigne.trim() || null, document: a.document ? "demo/s1.webp" : null,
      document_type: a.document ? "image/webp" : null, cree_at: iso(Date.now()), echeance: iso(Date.now() + h * 60 * MIN), clos_at: null, cible: a.sites, reps: [] });
    return id;
  },
  siegeCloreAlerte: async (id) => { const a = alertesDemo.find((x) => x.id === id); if (a) a.clos_at = iso(Date.now()); },
  sitesGestion: () => attendre(gestion.sites.map((x) => ({ ...x }))),
  referentielSite: (site) => { const r = refDemo(site); return attendre({ enceintes: r.enceintes.map((x) => ({ ...x })), friteuses: r.friteuses.map((x) => ({ ...x })), modeles: r.modeles.map((x) => ({ ...x })) }); },
  fournisseursGestion: async () => {
    if (!gestion.fournisseurs) gestion.fournisseurs = ["AMERICAN DESSERT", "BEAUVALLET", "CAFES RICHARD", "SYSCO"].map((nom, i) => ({
      id: `fg${i}`, nom, viande: nom === "BEAUVALLET", produits: nom === "CAFES RICHARD" ? ["sec"] : nom === "AMERICAN DESSERT" ? ["surgele"] : ["frais"], jours_livraison: null, actif: true }));
    return attendre(gestion.fournisseurs.map((x) => ({ ...x })));
  },
  siegeEnregistrer: async (table, ligne) => {
    const l = ligne as Record<string, unknown> & { id?: string; site_id?: string };
    if (table === "nettoyage_elements" || table === "produits_entretien" || table === "controles_modeles") {
      const lst = (table === "nettoyage_elements" ? planDemo : table === "controles_modeles" ? modelesDemo : entretienDemo) as unknown as Record<string, unknown>[];
      if (l.id) Object.assign(lst.find((x) => x.id === l.id) ?? {}, l); else lst.push({ ...l, id: `n${++gestion.n}` });
      return;
    }
    const liste: Record<string, unknown>[] = table === "sites" ? gestion.sites as never : table === "fournisseurs" ? (gestion.fournisseurs ?? []) as never
      : refDemo(l.site_id ?? "")[{ enceintes: "enceintes", friteuses: "friteuses", taches_modeles: "modeles" }[table] as "enceintes"] as never;
    if (l.id) Object.assign(liste.find((x) => x.id === l.id) ?? {}, l);
    else liste.push({ ...l, id: `n${++gestion.n}` });
  },
  siegeCreerRestaurant: async (nom, ville, ouverture, serviceSoir) => {
    if (gestion.sites.some((x) => x.nom.toUpperCase() === nom.trim().toUpperCase())) throw new Error("Un restaurant porte déjà ce nom");
    const id = `n${++gestion.n}`;
    gestion.sites.push({ id, nom: nom.trim().toUpperCase(), ville: ville.trim().toUpperCase(), ouverture, service_soir: serviceSoir, actif: true });
    return id;
  },
  employesSite: (site) => {
    if (!gestion.employes.has(site)) gestion.employes.set(site, [{ id: `${site}-p1`, nom: "Karim", role: "chef", actif: true }, { id: `${site}-p2`, nom: "Julie", role: "equipe", actif: true }]);
    return attendre(gestion.employes.get(site)!.map((x) => ({ ...x })));
  },
  siegeAjouterEmploye: async (site, nom, role) => {
    if (nom.trim().length < 2) throw new Error("Nom obligatoire");
    (gestion.employes.get(site) ?? gestion.employes.set(site, []).get(site)!).push({ id: `n${++gestion.n}`, nom: nom.trim(), role, actif: true });
    return pinDemo();
  },
  siegeNouveauPin: async () => pinDemo(),
  siegeModifierEmploye: async (id, nom, role, actif) => {
    for (const l of gestion.employes.values()) { const e = l.find((x) => x.id === id); if (e) Object.assign(e, { nom, role, actif }); }
  },
  tablettes: (site) => attendre(gestion.tablettes.filter((t) => t.site_id === site)),
  creerTablette: async (site, email, mdp) => {
    if (mdp.length < 10) throw new Error("Mot de passe trop court : 10 caractères au moins");
    if (gestion.tablettes.some((t) => t.email === email)) throw new Error("Cet e-mail est déjà utilisé");
    gestion.tablettes.push({ id: `t${++gestion.n}`, email, site_id: site, cree_at: new Date().toISOString(), derniere_connexion: null });
  },
  motDePasseTablette: async (_id, mdp) => { if (mdp.length < 10) throw new Error("Mot de passe trop court : 10 caractères au moins"); },
  siegeCloreProduit: async (id) => { const p = produitsDemo.find((x) => x.id === id); if (p) p.actif = false; },
  anomaliesSiege: () => attendre(anomaliesGroupe.map((a) => ({ ...a }))),
  etatRestaurants: async () => {
    // État du jour d'exemple, cohérent avec les anomalies du groupe ci-dessus.
    const ilYa = (min: number) => iso(Date.now() - min * MIN);
    const base = (i: number): EtatRestaurant => ({
      site_id: `s${i}`, nom: SITES_DEMO[i][0], ville: SITES_DEMO[i][1],
      taches_total: 9, taches_faites: 6, taches_en_retard: 0, taches_echues: 6,
      enceintes: 6, enceintes_relevees: 6, releves_hors_seuil: 0,
      friteuses: 4, friteuses_faites: 4, huile_rouges: 0, huile_trop_vieille: 0, huile_max: 16 + (i % 5),
      livraisons: 1 + (i % 3), livraisons_nc: 0, livraisons_non_rangees: 0,
      anomalies_ouvertes: 0, anomalies_a_verifier: 0, anomalies_critiques: 0,
      derniere_saisie: ilYa(4 + ((i * 7) % 35)), derniere_saisie_par: ["Karim", "Léa", "Hugo", "Inès", "Paul", "Nadia"][i % 6],
    });
    const ajust: Record<number, Partial<EtatRestaurant>> = {
      3: { taches_en_retard: 2, releves_hors_seuil: 1, anomalies_ouvertes: 1, anomalies_critiques: 1, derniere_saisie_par: "Karim" },
      6: { enceintes_relevees: 0, taches_en_retard: 1, anomalies_ouvertes: 1 },
      8: { taches_faites: 3, taches_echues: 6, taches_en_retard: 3, friteuses_faites: 0, huile_max: null, derniere_saisie: ilYa(190) },
      1: { huile_trop_vieille: 1, anomalies_a_verifier: 1 },
      0: { livraisons_nc: 1 },
      5: { huile_rouges: 1, huile_max: 26, taches_en_retard: 1 },
      2: { livraisons_non_rangees: 1 },
    };
    return attendre(SITES_DEMO.map((_, i) => ({ ...base(i), ...(ajust[i] ?? {}) })));
  },
  historiqueSite: async (_site, jours) => {
    const fin = new Date();
    return attendre(Array.from({ length: jours }, (_, k) => {
      const d = new Date(fin.getTime() - (jours - 1 - k) * 24 * 60 * MIN);
      const ech = 9, ok = [9, 9, 8, 9, 7, 9, 9, 8, 9, 6][k % 10];
      return { jour: d.toISOString().slice(0, 10), taches_echues: ech, taches_a_lheure: ok, taches_non_faites: k % 10 === 9 ? 1 : 0, anomalies: k % 7 === 3 ? 1 : 0, anomalies_critiques: k === jours - 1 ? 1 : 0 };
    }));
  },
  siegeChangerStatut: async (id, statut, commentaire) => {
    const a = anomaliesGroupe.find((x) => x.id === id);
    if (!a) throw new Error("Anomalie introuvable");
    if (a.statut === statut) return;
    const maintenant = new Date().toISOString();
    if (a.statut === "ouverte" && statut === "traitee") Object.assign(a, { statut, traitee_at: maintenant, traitee_par: "Siège (démo)", traitee_commentaire: commentaire ?? null });
    else if (a.statut === "traitee" && statut === "verifiee") Object.assign(a, { statut, verifiee_at: maintenant, verifiee_par: "Siège (démo)" });
    else throw new Error("Changement de statut non autorisé");
  },
  preuvesJour: async (_site, jour) => {
    const h = (hm: string) => `${jour}T${hm}:00+01:00`;
    const p: Preuves = {
      taches: [
        { titre: "Relevé températures du matin", echeance: h("11:00"), faite_at: h("10:42"), par: "Karim" },
        { titre: "Mesure de l'huile", echeance: h("11:30"), faite_at: h("11:51"), par: "Julie" },
        { titre: "Relevé températures du soir", echeance: h("18:00"), faite_at: null, par: null },
      ],
      releves: [
        { id: "p1", correction: correctionsDemo.get("p1") ?? null, rattrapage: null, enceinte: "Chambre froide positive", valeur: 2.8, t_max: 3, conforme: true, action: null, par: "Karim", at: h("10:42"), recu_at: h("13:05") },
        { id: "p2", correction: correctionsDemo.get("p2") ?? null, rattrapage: null, enceinte: "Chambre froide négative", valeur: -12, t_max: -18, conforme: false, action: "Denrées déplacées dans le congélateur du poste froid", par: "Karim", at: h("10:42") },
        { id: "p3", correction: correctionsDemo.get("p3") ?? null, rattrapage: null, enceinte: "Frigo poste chaud", valeur: 3.5, t_max: 4, conforme: true, action: null, par: "Karim", at: h("10:42") },
      ],
      huiles: [
        { id: "p4", correction: correctionsDemo.get("p4") ?? null, rattrapage: null, friteuse: "Friteuse 1", polaires: 14, filtrage: true, changement: false, non_utilisee: false, par: "Julie", at: h("11:51") },
        { id: "p5", correction: correctionsDemo.get("p5") ?? null, rattrapage: null, friteuse: "Friteuse 2", polaires: 22, filtrage: false, changement: true, non_utilisee: false, par: "Julie", at: h("11:51") },
        { id: "p6", correction: correctionsDemo.get("p6") ?? null, rattrapage: null, friteuse: "Friteuse 3", polaires: null, filtrage: false, changement: false, non_utilisee: true, par: "Julie", at: h("11:52") },
      ],
      livraisons: [
        { id: "p7", correction: correctionsDemo.get("p7") ?? null, fournisseur: "Transgourmet", t_camion: 2.5, t_frais: 3.1, t_surgele: -19, conforme: true, motifs: null, action: null, viande: true, origine_ok: true, photo_bl: "demo/bl1.webp", photo_nc: null, range_at: h("08:20"), par: "Mehdi", at: h("07:55") },
        { id: "p8", correction: correctionsDemo.get("p8") ?? null, fournisseur: "Pomona", t_camion: 8.6, t_frais: 7.2, t_surgele: null, conforme: false, motifs: ["Température"], action: "Produits refusés", viande: false, origine_ok: null, photo_bl: "demo/bl2.webp", photo_nc: null, range_at: null, par: "Mehdi", at: h("09:10") },
      ],
      produits: [
        { famille: "Viandes", service: "midi", photo: "demo/p1.webp", par: "Julie", at: h("11:20") },
        { famille: "Sauces", service: "midi", photo: "demo/p2.webp", par: "Julie", at: h("11:24") },
      ],
      anomalies: [{ titre: "Chambre froide négative à −12 °C", gravite: "critique", statut: "ouverte", at: h("10:42") }],
    };
    // Saisies oubliées ajoutées par le siège ce jour-là
    const ENC: Record<string, [string, number]> = { e1: ["Chambre froide positive", 3], e2: ["Chambre froide négative", -18], e3: ["Frigo poste chaud", 4] };
    rattrapagesDemo.filter((r) => r.at.slice(0, 10) === jour).forEach((r, k) => {
      const id = `r${k}`;
      if (r.type === "releve") {
        const [nom, t] = ENC[r.equipement] ?? ["Enceinte", 4];
        p.releves.push({ id, correction: null, rattrapage: r.motif, enceinte: nom, valeur: r.valeur, t_max: t, conforme: r.valeur <= t, action: r.action, par: "Siège (démo)", at: r.at });
      } else {
        p.huiles.push({ id, correction: null, rattrapage: r.motif, friteuse: `Friteuse ${r.equipement.slice(1)}`, polaires: r.valeur, filtrage: r.decision === "filtree", changement: r.decision === "changee", non_utilisee: false, par: "Siège (démo)", at: r.at });
      }
    });
    p.releves.sort((x, y) => x.at.localeCompare(y.at)); p.huiles.sort((x, y) => x.at.localeCompare(y.at));
    return attendre(p);
  },
  siegeCorriger: async (_table, id, motif, valeur) => {
    if (motif.trim().length < 5) throw new Error("Motif obligatoire (5 caractères au moins)");
    correctionsDemo.set(id, { motif: motif.trim(), valeur, par: "Siège (démo)", at: new Date().toISOString() });
  },
  equipementsSite: async () => attendre({
    enceintes: [{ id: "e1", nom: "Chambre froide positive", t_max: 3 }, { id: "e2", nom: "Chambre froide négative", t_max: -18 }, { id: "e3", nom: "Frigo poste chaud", t_max: 4 }],
    friteuses: [1, 2, 3, 4].map((i) => ({ id: `f${i}`, nom: `Friteuse ${i}`, litres: 25 })),
  }),
  siegeRattraper: async (r) => {
    if (r.motif.trim().length < 5) throw new Error("Motif obligatoire (5 caractères au moins)");
    if (new Date(r.at) > new Date()) throw new Error("L'heure de la saisie oubliée doit être passée");
    rattrapagesDemo.push(r);
  },
  urlPhoto: async (chemin) => {
    const b = recuDemo.photos.get(chemin);
    if (b) return URL.createObjectURL(b);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="100%" height="100%" fill="#e8ecef"/><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#667">Photo (démo)</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  },
  estSiege: async () => typeof location !== "undefined" && (location.hash === "#siege" || new URLSearchParams(location.search).has("siege")),
  tableauSiege: async (jours) => SITES_DEMO.map((s, i) => {
    // Chiffres d'exemple déterministes (mêmes à chaque chargement), proportionnels à la période.
    const r = (k: number) => ((i * 37 + k * 11) % 17) / 17;
    const f = jours / 7, total = Math.round(70 * f), aLheure = Math.round(total * (0.72 + r(1) * 0.26));
    const ouvertes = Math.round(r(4) * 6), critiques = ouvertes && r(5) > 0.85 ? 1 : 0;
    const mesures = Math.round((12 + r(9) * 2) * f), rouges = Math.min(mesures, r(10) > 0.8 ? Math.ceil(f) : 0);
    return {
      site_id: `s${i}`, nom: s[0], ville: s[1], taches_total: total, taches_a_lheure: aLheure,
      taches_non_faites: Math.round((total - aLheure) * 0.15), anomalies_ouvertes: ouvertes, anomalies_critiques: critiques,
      anomalies_a_verifier: Math.round(r(12) * 3), huile_trop_vieille: r(13) > 0.85 ? 1 : 0,
      plus_ancienne_h: ouvertes ? Math.max(1, Math.round(r(6) * 90)) : null,
      livraisons: Math.round((18 + r(7) * 8) * f), livraisons_nc: Math.round(r(8) * 3 * f),
      huile_mesures: mesures, huile_rouges: rouges, huile_max: Math.round((14 + r(11) * 12) * 10) / 10,
    };
  }),
  fournisseursNonConformes: async () => [
    { fournisseur: "Boucherie (viandes)", livraisons: 64, non_conformes: 7 },
    { fournisseur: "Pomona", livraisons: 120, non_conformes: 5 },
    { fournisseur: "Transgourmet", livraisons: 138, non_conformes: 3 },
    { fournisseur: "Metro", livraisons: 42, non_conformes: 1 },
    { fournisseur: "Brake", livraisons: 55, non_conformes: 0 },
  ],
  anomaliesOuvertes: () => attendre(anomalies.filter((a) => a.statut !== "verifiee").map((a) => ({ ...a }))),

  async televerserPhoto(chemin, blob) {
    if (horsLigne()) throw new TypeError("Failed to fetch");
    recuDemo.photos.set(chemin, blob);
  },
  async executer(op: Operation) {
    await attendre(null);
    if (horsLigne()) throw new TypeError("Failed to fetch");
    const nouveau = (id: string) => { if (recuDemo.ids.has(id)) return false; recuDemo.ids.add(id); return true; };
    const terminer = (tacheId?: string) => {
      const t = taches.find((x) => x.id === tacheId);
      if (t && !t.faite_at) { t.faite_at = op.at_client; t.faite_par_nom = op.par_nom; }
    };
    switch (op.type) {
      case "terminer_tache": terminer(op.tache_id); break;
      case "anomalies":
        op.lignes.forEach((a) => {
          if (nouveau(a.id)) anomalies.unshift({ id: a.id, titre: a.titre, categorie: a.categorie, gravite: a.gravite, statut: "ouverte", cree_at: op.at_client });
        });
        break;
      case "releves":
        op.lignes.forEach((l) => nouveau(l.id));
        terminer(op.tache_id);   // comme le vrai serveur : la saisie clôt la tâche
        break;
      case "huile":
        op.lignes.forEach((l) => {
          if (!nouveau(l.id)) return;
          const e = etatHuile.find((x) => x.friteuse_id === l.friteuse_id);
          if (!e) return;
          const dejaCompte = !!e.aujourd_hui_at && !e.aujourd_hui_non_utilisee;
          if (l.changement) { e.jours_utilisation = 1; e.dernier_changement = op.at_client; }
          else if (!l.non_utilisee && !dejaCompte) e.jours_utilisation++;
          e.aujourd_hui_at = op.at_client; e.aujourd_hui_polaires = l.polaires; e.aujourd_hui_non_utilisee = !!l.non_utilisee;
        });
        terminer(op.tache_id);   // la tablette n'envoie la tâche que lorsque toutes les friteuses sont faites
        break;
      case "livraison":
        if (nouveau(op.id)) {
          recuDemo.livraisons++;
          livraisonsDemo.push({ id: op.id, fournisseur: op.fournisseur_nom, at: op.at_client, t_camion: op.t_camion, conforme: op.conforme,
            action: op.action ?? null, produits_refuses: op.produits_refuses ?? null, pages: 1 + (op.photos_bl_suite?.length ?? 0), range_at: null });
        }
        break;
      case "utilisation": if (nouveau(op.id)) recuDemo.utilisations++; break;
      case "stock_mort": {
        const p = produitsDemo.find((x) => x.id === op.produit_id);
        if (p && nouveau(op.id)) p.inv.push({ site_id: "s3", reste: op.reste, quantite: op.quantite ?? null, dlc: op.dlc ?? null, photo: op.photo ?? null,
          decision: op.decision ?? null, transfert_vers: op.transfert_vers ?? null, par: op.par_nom ?? "", at: op.at_client });
        break;
      }
      case "document_pms":
        deposerDocDemo("s3", op.document, op.fichier, op.par_nom);
        break;
      case "document_archive": {
        const a = docsDemo.find((x) => x.id === op.document_id);
        if (a && a.site === null) throw new ErreurDefinitive("Document du groupe : réservé au siège");
        if (a) Object.assign(a, { actif: false, archive_at: iso(Date.now()) });
        break;
      }
      case "visite":
        ajouterVisiteDemo(op.visite, op.rapport ?? null, op.par_nom);
        break;
      case "analyses":
        ajouterAnalysesDemo(op.visite_id, op.analyses, op.rapport ?? null);
        break;
      case "controle_fait": {
        if (!nouveau(op.id)) break;
        controlesFaitsDemo.push({ site: "s3", modele: op.modele_id, date: op.date_realisation, conforme: op.conforme, observation: op.observation ?? null,
          prestataire: op.prestataire ?? null, photo: op.photo ?? null, document: null, par: op.par_nom });
        const m = modelesDemo.find((x) => x.id === op.modele_id);
        if (!op.conforme && m) anomalies.unshift({ id: `ac-${op.id}`, titre: `${m.titre} : ${op.observation}`, categorie: m.rubrique === "nuisibles" ? "Nuisibles" : "Entretien technique",
          gravite: "majeure", statut: "ouverte", cree_at: op.at_client, source: "controle", photo: op.photo });
        break;
      }
      case "verification_mesure": {
        if (!nouveau(op.id)) break;
        const a = appareilsDemo.find((x) => x.id === op.appareil_id);
        if (!a) break;
        const conforme = op.methode === "certificat" ? op.conforme : lectureConforme(op.methode, op.valeur ?? NaN);
        a.dernier = { date: op.at_client.slice(0, 10), methode: op.methode, valeur: op.valeur ?? null, conforme, photo: op.photo, document: null, par: op.par_nom };
        a.hors_service = !conforme;
        if (!conforme) anomalies.unshift({ id: `am-${op.id}`, titre: `Appareil hors tolérance : ${a.nom}${op.valeur !== undefined ? ` (lu ${op.valeur} °C)` : ""}`,
          categorie: "Métrologie", gravite: "majeure", statut: "ouverte", cree_at: op.at_client, source: "metrologie" });
        break;
      }
      case "action_planifiee": {
        const a = anomalies.find((x) => x.id === op.anomalie_id);
        if (a) Object.assign(a, { action_prevue: op.action, echeance: op.echeance, responsable_id: op.responsable_id });
        break;
      }
      case "nettoyage_fait": {
        const cleFait = `${op.tache_id}:${op.element_id}`;
        if (!faitsDemo.has(cleFait)) faitsDemo.set(cleFait, { par: op.par_nom, at: op.at_client, photo: op.photo ?? null });
        const t = tachesNettoyageDemo().find((x) => x.tache_id === op.tache_id);
        if (t && t.elements.every((e) => e.fait)) terminer(op.tache_id);
        break;
      }
      case "reponse_alerte": {
        const a = alertesDemo.find((x) => x.id === op.alerte_id);
        if (a && nouveau(op.id)) a.reps.push({ site_id: "s3", trouve: op.trouve, lot: op.lot ?? null, quantite: op.quantite ?? null, action: op.action ?? null,
          photo: op.photo ?? null, photo_action: op.photo_action ?? null, at: op.at_client, par: op.par_nom });
        break;
      }
      case "livraison_rangee": {
        const l = livraisonsDemo.find((x) => x.id === op.livraison_id);
        if (l && !l.range_at) l.range_at = op.at_client;
        break;
      }
      case "minuteur": nouveau(op.id); break;
      case "anomalie_statut": {
        const a = anomalies.find((x) => x.id === op.anomalie_id);
        const role = profils.find((p) => p.id === op.par)?.role ?? "equipe";
        if (!a) break;
        if (a.statut === op.statut) break;                       // déjà fait (envoi rejoué)
        if (!transitionPermise(a.statut, op.statut, role, a.gravite, a.source)) throw new ErreurDefinitive("Changement de statut non autorisé");
        a.statut = op.statut;
        if (op.preuve) a.preuve = op.preuve;
        if (op.commentaire) a.traitee_commentaire = op.commentaire;
        break;
      }
    }
  },
};
