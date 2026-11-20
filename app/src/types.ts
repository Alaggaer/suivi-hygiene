import type { Operation } from "./operations";

export type Role = "equipe" | "chef" | "responsable" | "siege";
export type Gravite = "mineure" | "majeure" | "critique";
export type TypeTache = "releves" | "huile" | "nettoyage" | "dlc" | "stock_carte" | "autre";

export interface Site { id: string; nom: string; ville: string }
export interface Profil { id: string; nom: string; role: Role }
export interface Enceinte { id: string; nom: string; t_max: number }
export interface Friteuse { id: string; nom: string; litres: number }
export interface SeuilsHuile { orange: number; rouge: number }

export interface Tache {
  id: string;
  type: TypeTache;
  titre: string;
  echeance: string;          // ISO
  faite_at: string | null;
  faite_par_nom: string | null;
  escalade: number;          // 0 rien, 1 chef prévenu, 2 responsable prévenu
}

export interface Fournisseur { id: string; nom: string }

export interface Anomalie {
  id: string; titre: string; categorie: string; gravite: Gravite;
  statut: "ouverte" | "traitee" | "verifiee"; cree_at: string;
  enAttente?: boolean;       // saisie sur la tablette, pas encore reçue par le serveur
}

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
  anomaliesOuvertes(): Promise<Anomalie[]>;
  fournisseurs(): Promise<Fournisseur[]>;
  /** Écritures : appelées uniquement par la file d'envoi, et rejouables sans doublon. */
  executer(op: Operation): Promise<void>;
  televerserPhoto(chemin: string, blob: Blob): Promise<void>;
}
