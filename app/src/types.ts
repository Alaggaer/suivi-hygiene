import type { Operation } from "./operations";

export type Role = "equipe" | "chef" | "responsable" | "siege";
export type Gravite = "mineure" | "majeure" | "critique";
export type TypeTache = "releves" | "huile" | "nettoyage" | "dlc" | "stock_carte" | "autre";

export interface Site { id: string; nom: string; ville: string }
export interface Profil { id: string; nom: string; role: Role }
export interface Enceinte { id: string; nom: string; t_max: number }
export interface Friteuse { id: string; nom: string; litres: number }
export interface SeuilsHuile { orange: number; rouge: number; jours_max?: number }
/** Où en est chaque friteuse : jours d'utilisation de l'huile en place, et saisie déjà faite aujourd'hui. */
export interface EtatFriteuse {
  friteuse_id: string; jours_utilisation: number; dernier_changement: string | null;
  aujourd_hui_at: string | null; aujourd_hui_polaires: number | null; aujourd_hui_non_utilisee: boolean | null;
}

export interface Tache {
  id: string;
  type: TypeTache;
  titre: string;
  echeance: string;          // ISO
  faite_at: string | null;
  faite_par_nom: string | null;
  escalade: number;          // 0 rien, 1 chef prévenu, 2 responsable prévenu
}

/** viande : la question de l'origine est posée ; jours : jours de livraison habituels (1 = lundi … 7 = dimanche). */
export type ProduitLivre = "frais" | "sec" | "surgele";
/** Familles de produits frais, chacune avec sa température de réception (classeur HACCP du groupe). */
export type FamilleFrais = "bof" | "poisson" | "viande" | "legumes";
/* ---------- Espace PMS : plan d'action, contrôles, métrologie ---------- */
export interface ActionPlan {
  id: string; titre: string; categorie: string; gravite: Gravite; statut: "ouverte" | "traitee" | "verifiee"; source: string;
  cree_at: string; photo: string | null; action_prevue: string | null; echeance: string | null;
  responsable_id: string | null; responsable: string | null; preuve: string | null;
  traitee_at: string | null; traitee_par: string | null; traitee_commentaire: string | null; verifiee_at: string | null; verifiee_par: string | null;
}
export type EtatControle = "a_jour" | "bientot" | "retard" | "jamais" | "hors_service";
export type RubriqueControle = "entretien" | "nuisibles";
export interface ControleSite {
  id: string; rubrique: RubriqueControle; titre: string; methode: string | null; periodicite_mois: number;
  preuve: "aucune" | "photo" | "document"; prestataire: boolean;
  dernier: { date: string; conforme: boolean; observation: string | null; prestataire: string | null; photo: string | null; document: string | null; par: string | null } | null;
  prochaine: string | null; etat: EtatControle;
}
export interface ModeleControle {
  id?: string; rubrique: RubriqueControle; titre: string; methode: string | null; periodicite_mois: number;
  preuve: "aucune" | "photo" | "document"; prestataire: boolean; sites: string[] | null; ordre: number; actif: boolean;
}
export type MethodeMesure = "glace" | "ebullition" | "certificat";
export interface AppareilMesure {
  id: string; nom: string; type: "sonde" | "infrarouge" | "enregistreur" | "autre"; numero: string | null; hors_service: boolean;
  dernier: { date: string; methode: MethodeMesure; valeur: number | null; conforme: boolean; photo: string | null; document: string | null; par: string | null } | null;
  prochaine: string | null; etat: EtatControle;
}
export type TypeVisite = "eurofins" | "officielle" | "interne" | "autre";
export type NiveauVisite = "tres_satisfaisant" | "satisfaisant" | "a_ameliorer" | "a_corriger";
export type ResultatAnalyse = "satisfaisant" | "acceptable" | "non_satisfaisant";
export interface AnalyseSaisie { id: string; categorie: "surface" | "produit" | "eau" | "autre"; objet: string; resultat: ResultatAnalyse; detail?: string; date_prelevement?: string }
export interface Analyse extends Required<Omit<AnalyseSaisie, "detail">> { detail: string | null; rapport: string | null }
export interface Visite {
  id: string; type: TypeVisite; date_visite: string; organisme: string | null; intervenant: string | null; note: number | null;
  niveau: NiveauVisite | null; rapport: string | null; commentaire: string | null; par: string | null;
  ecarts: { id: string; titre: string; gravite: Gravite; statut: "ouverte" | "traitee" | "verifiee" }[]; analyses: Analyse[];
}
export interface EtatVisites {
  eurofins_mois: number; derniere_eurofins: string | null; prochaine_eurofins: string | null; etat_eurofins: EtatControle; visites: Visite[];
}
/** Saisie d'une visite (tablette ou siège). */
export interface VisiteSaisie {
  id: string; type: TypeVisite; date_visite: string; organisme?: string; intervenant?: string; note?: number; niveau?: NiveauVisite;
  commentaire?: string; ecarts: { texte: string; gravite: Gravite }[]; analyses: AnalyseSaisie[];
}
export interface PmsGroupe {
  site_id: string; restaurant: string; controles: ControleSite[]; metrologie: AppareilMesure[];
  visites: Omit<EtatVisites, "visites">; derniere_visite: { type: TypeVisite; date_visite: string; note: number | null; niveau: NiveauVisite | null } | null;
  analyses_non_satisfaisantes: number;
  actions_ouvertes: number; actions_en_retard: number; actions_sans_plan: number;
}

/* ---------- Classeur des documents du PMS ---------- */
export type RubriqueDocument = "haccp" | "formation" | "administratif" | "contrats" | "nuisibles" | "autre";
export interface TypeDocument { cle: string; libelle: string; rubrique: RubriqueDocument; niveau: "groupe" | "site"; obligatoire: boolean; expire: boolean; ordre: number }
export interface DocumentPms {
  id: string; groupe: boolean; type_cle: string; type: string; rubrique: RubriqueDocument; titre: string; fichier: string;
  expire_le: string | null; personne: string | null; par: string | null; at: string; etat: EtatControle;
}
export interface ClasseurSite { documents: DocumentPms[]; attendus: { cle: string; libelle: string; rubrique: RubriqueDocument; niveau: "groupe" | "site"; present: boolean }[] }
export interface DocumentArchive { id: string; groupe: boolean; type: string; titre: string; fichier: string; expire_le: string | null; personne: string | null; at: string; archive_at: string }
export interface DocumentSaisie { id: string; type_cle: string; titre: string; expire_le?: string; personne?: string; remplace?: string }

/* ---------- Plan de nettoyage et de désinfection ---------- */
export interface ProduitEntretien {
  id?: string; nom: string; usage: string | null; dilution: string | null; temps_contact: string | null;
  ft: string | null; fds: string | null; actif: boolean;
}
export type FrequenceNettoyage = "jour" | "semaine" | "mois";
export interface ElementNettoyage {
  id?: string; zone: string; element: string; frequence: FrequenceNettoyage; jour: number | null; heure_limite: string;
  produit_id: string | null; methode: string | null; photo_obligatoire: boolean; sites: string[] | null; ordre: number; actif: boolean;
}
export interface ElementATaire {
  id: string; zone: string; element: string; methode: string | null; photo_obligatoire: boolean;
  produit: { id: string; nom: string; dilution: string | null; temps_contact: string | null; ft: string | null; fds: string | null } | null;
  fait: { par: string | null; at: string; photo: string | null } | null;
}
export interface TacheNettoyage { tache_id: string; zone: string; echeance: string; elements: ElementATaire[] }
export interface NettoyageSiege {
  site_id: string; restaurant: string;
  taches: { id: string; zone: string; echeance: string; faite_at: string | null; total: number; faits: number;
    photos: { element: string; photo: string; par: string | null; at: string }[] }[];
}

/* ---------- Alertes produit (siège → restaurants) ---------- */
export type TypeAlerte = "prolongation" | "retrait";
export type ActionAlerte = "reetiquete" | "isole" | "repris" | "detruit";
export interface ReponseAlerte {
  trouve: boolean; lot: string | null; quantite: string | null; action: ActionAlerte | null; at: string;
  photo?: string | null; photo_action?: string | null; par?: string | null;
}
export interface AlerteProduit {
  id: string; type: TypeAlerte; produit: string; fournisseur: string | null; lots: string | null;
  ddm_origine: string | null; ddm_nouvelle: string | null; consigne: string | null;
  document: string | null; document_type: string | null; cree_at: string; echeance: string; reponses: ReponseAlerte[];
}
export interface AlerteSiege extends Omit<AlerteProduit, "reponses"> {
  clos_at: string | null; sites: { site_id: string; restaurant: string; reponses: ReponseAlerte[] }[];
}
export interface NouvelleAlerte {
  type: TypeAlerte; produit: string; fournisseur_id: string | null; lots: string; ddm_origine: string | null; ddm_nouvelle: string | null;
  date_est_ddm: boolean; consigne: string; document: File | null; sites: string[] | null;
}

/* ---------- Gestion par le siège ---------- */
export type RoleEmploye = "equipe" | "chef" | "responsable";
export interface Employe { id: string; nom: string; role: RoleEmploye; actif: boolean }
export interface SiteGestion { id: string; nom: string; ville: string; ouverture: string; service_soir: string; actif: boolean }
export interface EnceinteGestion { id?: string; site_id: string; nom: string; t_max: number; ordre: number; actif: boolean }
export interface FriteuseGestion { id?: string; site_id: string; nom: string; litres: number; actif: boolean }
export interface ModeleTache { id?: string; site_id: string; type: string; titre: string; heure_limite: string; jours: number[]; actif: boolean }
export interface FournisseurGestion { id?: string; nom: string; viande: boolean; produits: ProduitLivre[] | null; familles?: FamilleFrais[] | null; jours_livraison: number[] | null; actif: boolean }
export interface Tablette { id: string; email: string; site_id: string; cree_at: string; derniere_connexion: string | null }
export type TableGestion = "controles_modeles" | "sites" | "enceintes" | "friteuses" | "taches_modeles" | "fournisseurs" | "nettoyage_elements" | "produits_entretien";
/** Stocks morts : produit sorti de la carte (déclaré par le siège), et où en est ce restaurant. */
export type EtatStock = "a_verifier" | "a_ecouler" | "solde";
export type DecisionStock = "jete" | "transfere" | "a_ecouler";
export interface StockMort {
  produit_id: string; nom: string; fournisseur: string | null; consigne: string | null; sortie_le: string;
  etat: EtatStock; quantite: string | null; dlc: string | null; verifie_at: string | null; a_faire: boolean;
}
export interface StockMortSiege {
  id: string; nom: string; fournisseur: string | null; consigne: string | null; sortie_le: string; actif: boolean;
  sites: { site_id: string; restaurant: string; etat: EtatStock; quantite: string | null; dlc: string | null; photo: string | null;
    decision: DecisionStock | null; transfert_vers: string | null; par: string | null; at: string | null }[];
}
export interface Fournisseur { id: string; nom: string; viande?: boolean; jours?: number[] | null; produits?: ProduitLivre[] | null; familles?: FamilleFrais[] | null }
/** Livraison reçue aujourd'hui (liste de l'écran Livraisons). */
export interface LivraisonJour {
  id: string; fournisseur: string; at: string; t_camion: number; conforme: boolean; action: string | null;
  produits_refuses: string | null; pages: number; range_at: string | null;
}

export interface Anomalie {
  id: string; titre: string; categorie: string; gravite: Gravite;
  statut: "ouverte" | "traitee" | "verifiee"; cree_at: string; source?: string;
  enAttente?: boolean;       // saisie sur la tablette, pas encore reçue par le serveur
}

export interface LigneSiege {
  site_id: string; nom: string; ville: string;
  taches_total: number; taches_a_lheure: number; taches_non_faites: number;
  anomalies_ouvertes: number; anomalies_a_verifier: number; anomalies_critiques: number; plus_ancienne_h: number | null;
  livraisons: number; livraisons_nc: number;
  huile_mesures: number; huile_rouges: number; huile_max: number | null; huile_trop_vieille: number;
}
/** État du jour d'un restaurant (cartes de l'accueil siège). */
export interface EtatRestaurant {
  site_id: string; nom: string; ville: string;
  taches_total: number; taches_faites: number; taches_en_retard: number; taches_echues: number;
  enceintes: number; enceintes_relevees: number; releves_hors_seuil: number;
  friteuses: number; friteuses_faites: number; huile_rouges: number; huile_trop_vieille: number; huile_max: number | null;
  livraisons: number; livraisons_nc: number; livraisons_non_rangees: number;
  anomalies_ouvertes: number; anomalies_a_verifier: number; anomalies_critiques: number;
  derniere_saisie: string | null; derniere_saisie_par: string | null;
}
export interface JourHistorique { jour: string; taches_echues: number; taches_a_lheure: number; taches_non_faites: number; anomalies: number; anomalies_critiques: number }
/** Anomalie vue du siège : tous les restaurants, avec qui l'a créée, traitée, vérifiée. */
export interface AnomalieSiege {
  id: string; site_id: string; restaurant: string; titre: string; categorie: string; gravite: Gravite;
  statut: Anomalie["statut"]; cree_at: string; cree_par: string | null;
  traitee_at: string | null; traitee_par: string | null; traitee_commentaire: string | null;
  verifiee_at: string | null; verifiee_par: string | null; photo: string | null;
}
/** Rattrapage par le siège : la saisie d'origine reste, la correction s'y ajoute (valeur null = saisie annulée). */
export interface Correction { motif: string; valeur: number | null; par: string; at: string }
export type TableCorrigeable = "releves" | "huiles" | "livraisons";
export type Rattrapage =
  | { type: "releve"; equipement: string; at: string; valeur: number; motif: string; action: string | null }
  | { type: "huile"; equipement: string; at: string; valeur: number; motif: string; decision: "filtree" | "changee" };
/** Preuves d'un restaurant pour un jour (ce qu'on montre lors d'un contrôle). */
export interface Preuves {
  taches: { titre: string; echeance: string; faite_at: string | null; par: string | null }[];
  releves: { id: string; recu_at?: string; correction: Correction | null; rattrapage: string | null; enceinte: string; valeur: number; t_max: number; conforme: boolean; action: string | null; par: string; at: string }[];
  huiles: { id: string; recu_at?: string; correction: Correction | null; rattrapage: string | null; friteuse: string; polaires: number | null; filtrage: boolean; changement: boolean; non_utilisee: boolean; par: string; at: string }[];
  livraisons: { id: string; recu_at?: string; correction: Correction | null; photos_bl_suite?: string[]; produits_refuses?: string | null; fournisseur: string; t_camion: number; t_frais: number | null; t_surgele: number | null; t_produits?: Partial<Record<FamilleFrais, number>> | null; conforme: boolean; motifs: string[] | null;
    action: string | null; viande: boolean; origine_ok: boolean | null; photo_bl: string; photo_nc: string | null; range_at: string | null; par: string; at: string }[];
  produits: { recu_at?: string; famille: string; service: string; photo: string; par: string; at: string }[];
  anomalies: { titre: string; gravite: Gravite; statut: Anomalie["statut"]; at: string }[];
}
export interface FournisseurNC { fournisseur: string; livraisons: number; non_conformes: number }

/** Tout ce que l'app demande au serveur. Deux implémentations : Supabase (production) et démo (en mémoire). */
export interface Api {
  mode: "supabase" | "demo";
  estActivee(): Promise<boolean>;
  activer(email: string, motDePasse: string): Promise<void>;
  site(): Promise<Site>;
  profils(): Promise<Profil[]>;
  verifierPin(profilId: string, pin: string): Promise<boolean>;
  taches(): Promise<Tache[]>;
  enceintes(): Promise<Enceinte[]>;
  friteuses(): Promise<Friteuse[]>;
  seuilsHuile(): Promise<SeuilsHuile>;
  etatFriteuses(): Promise<EtatFriteuse[]>;
  anomaliesOuvertes(): Promise<Anomalie[]>;
  fournisseurs(): Promise<Fournisseur[]>;
  livraisonsDuJour(): Promise<LivraisonJour[]>;
  stocksMortsDuSite(): Promise<StockMort[]>;
  stocksMortsSiege(): Promise<StockMortSiege[]>;
  siegeRetirerProduit(nom: string, fournisseurId: string | null, consigne: string): Promise<void>;
  siegeCloreProduit(id: string): Promise<void>;
  /* Espace PMS */
  planAction(siteId: string): Promise<ActionPlan[]>;
  etatControles(siteId: string): Promise<ControleSite[]>;
  etatMetrologie(siteId: string): Promise<AppareilMesure[]>;
  /** En ligne seulement : le chef ou le responsable ajoute une sonde ou un thermomètre. */
  ajouterAppareil(profilId: string, nom: string, type: AppareilMesure["type"], numero: string): Promise<void>;
  pmsGroupe(): Promise<PmsGroupe[]>;
  typesDocuments(): Promise<TypeDocument[]>;
  /** siteId null (siège) : les documents du groupe seulement. */
  documentsSite(siteId: string | null): Promise<ClasseurSite>;
  documentsArchives(siteId: string | null): Promise<DocumentArchive[]>;
  documentsGroupe(): Promise<{ site_id: string; manquants: number; expires: number; bientot: number }[]>;
  /** siteId null : document du groupe (visible par tous les restaurants). */
  siegeEnregistrerDocument(siteId: string | null, d: DocumentSaisie, fichier: File): Promise<void>;
  siegeArchiverDocument(id: string): Promise<void>;
  etatVisites(siteId: string): Promise<EtatVisites>;
  siegeEnregistrerVisite(siteId: string, v: VisiteSaisie, rapport: File | null): Promise<void>;
  siegeAjouterAnalyses(siteId: string, visiteId: string, analyses: AnalyseSaisie[], rapport: File | null): Promise<void>;
  modelesControles(): Promise<ModeleControle[]>;
  siegePlanifierAction(anomalieId: string, action: string, echeance: string, responsableId: string | null): Promise<void>;
  siegeEnregistrerControle(siteId: string, modeleId: string, date: string, conforme: boolean, observation: string, prestataire: string, document: File | null): Promise<void>;
  /* Plan de nettoyage */
  nettoyageDuJour(): Promise<TacheNettoyage[]>;
  produitsEntretien(): Promise<ProduitEntretien[]>;
  planNettoyage(): Promise<ElementNettoyage[]>;
  nettoyageSiege(jour: string): Promise<NettoyageSiege[]>;
  /** Dépose une FT ou une FDS (PDF) ; renvoie son chemin. */
  /** siteId absent : document du groupe ; sinon pièce rangée dans le dossier du restaurant. */
  siegeDeposerDocument(f: File, siteId?: string | null): Promise<string>;
  /* Alertes produit */
  alertesDuSite(): Promise<AlerteProduit[]>;
  alertesSiege(): Promise<AlerteSiege[]>;
  siegeCreerAlerte(a: NouvelleAlerte): Promise<string>;
  siegeCloreAlerte(id: string): Promise<void>;
  /* Gestion par le siège */
  sitesGestion(): Promise<SiteGestion[]>;
  referentielSite(siteId: string): Promise<{ enceintes: EnceinteGestion[]; friteuses: FriteuseGestion[]; modeles: ModeleTache[] }>;
  fournisseursGestion(): Promise<FournisseurGestion[]>;
  /** Crée (sans id) ou modifie une ligne d'une table de paramétrage. */
  siegeEnregistrer(table: TableGestion, ligne: Record<string, unknown>): Promise<void>;
  siegeCreerRestaurant(nom: string, ville: string, ouverture: string, serviceSoir: string): Promise<string>;
  employesSite(siteId: string): Promise<Employe[]>;
  /** Renvoie le PIN, à communiquer à l'employé (il n'est plus jamais lisible ensuite). */
  siegeAjouterEmploye(siteId: string, nom: string, role: RoleEmploye): Promise<string>;
  siegeNouveauPin(profilId: string): Promise<string>;
  siegeModifierEmploye(profilId: string, nom: string, role: RoleEmploye, actif: boolean): Promise<void>;
  tablettes(siteId: string): Promise<Tablette[]>;
  creerTablette(siteId: string, email: string, motDePasse: string): Promise<void>;
  motDePasseTablette(userId: string, motDePasse: string): Promise<void>;
  /** Siège : compte connecté avec le rôle « siege » (tableau de bord au lieu de l'écran tablette). */
  estSiege(): Promise<boolean>;
  tableauSiege(jours: number): Promise<LigneSiege[]>;
  fournisseursNonConformes(jours: number): Promise<FournisseurNC[]>;
  anomaliesSiege(): Promise<AnomalieSiege[]>;
  etatRestaurants(): Promise<EtatRestaurant[]>;
  /** Santé de l'envoi des alertes e-mail (siège). */
  etatAlertes(): Promise<EtatAlertes>;
  historiqueSite(siteId: string, jours: number): Promise<JourHistorique[]>;
  /** Le siège traite ou vérifie une anomalie (en ligne uniquement, sous son propre profil). */
  siegeChangerStatut(id: string, statut: "traitee" | "verifiee", commentaire?: string): Promise<void>;
  preuvesJour(siteId: string, jour: string): Promise<Preuves>;
  /** Le siège corrige une saisie erronée : motif obligatoire, valeur corrigée facultative (absente = saisie annulée). */
  siegeCorriger(table: TableCorrigeable, id: string, motif: string, valeur: number | null): Promise<void>;
  /** Équipements d'un restaurant (pour le rattrapage siège). */
  equipementsSite(siteId: string): Promise<{ enceintes: Enceinte[]; friteuses: Friteuse[] }>;
  /** Le siège saisit après coup un relevé ou une mesure d'huile oubliés (signalé comme tel, motif obligatoire). */
  siegeRattraper(r: Rattrapage): Promise<void>;
  /** Lien temporaire (1 h) vers une photo du stockage privé. */
  urlPhoto(chemin: string): Promise<string>;
  /** Écritures : appelées uniquement par la file d'envoi, et rejouables sans doublon. */
  executer(op: Operation): Promise<void>;
  televerserPhoto(chemin: string, blob: Blob): Promise<void>;
}

export interface EtatAlertes {
  ok: boolean; appels_reussis_1h: number; appels_en_echec_1h: number; dernier_appel_reussi: string | null;
  dernier_echec: string | null; planification_en_echec_1h: number; alertes_non_envoyees: number; alertes_sans_destinataire: number;
}
