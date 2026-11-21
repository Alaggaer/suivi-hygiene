import type { Gravite } from "./types";

/**
 * Tout ce que la tablette écrit passe par une « opération » mise en file d'attente.
 * Chaque ligne porte un identifiant créé sur la tablette : si un envoi est rejoué
 * (réseau coupé au mauvais moment), le serveur ignore le doublon.
 */
interface Base { par: string; par_nom: string; at_client: string }

export interface LigneReleve { id: string; enceinte_id: string; valeur: number; t_max: number; action?: string }
export interface LigneHuile { id: string; friteuse_id: string; polaires: number | null; filtrage: boolean; changement: boolean; litres?: number; non_utilisee?: boolean }
export interface LigneAnomalie { id: string; source: string; categorie: string; gravite: Gravite; titre: string; photo?: string; ref_id?: string }

export type Operation =
  | (Base & { type: "releves"; tache_id?: string; lignes: LigneReleve[] })
  | (Base & { type: "huile"; tache_id?: string; lignes: LigneHuile[] })
  | (Base & { type: "anomalies"; lignes: LigneAnomalie[] })
  | (Base & { type: "terminer_tache"; tache_id: string })
  | (Base & {
      type: "livraison"; id: string; fournisseur_id: string; fournisseur_nom: string;
      t_camion: number; t_frais?: number; t_surgele?: number; photo_bl: string; photos_bl_suite?: string[];
      viande: boolean; origine_ok?: boolean; conforme: boolean; motifs?: string[]; action?: string; photo_nc?: string;
      produits_refuses?: string;
    })
  | (Base & { type: "livraison_rangee"; livraison_id: string })
  | (Base & {
      type: "stock_mort"; id: string; produit_id: string; reste: boolean;
      quantite?: string; dlc?: string; photo?: string; decision?: "jete" | "transfere" | "a_ecouler"; transfert_vers?: string;
    })
  | (Base & { type: "nettoyage_fait"; id: string; tache_id: string; element_id: string; photo?: string })
  | (Base & {
      type: "reponse_alerte"; id: string; alerte_id: string; trouve: boolean;
      lot?: string; quantite?: string; photo?: string; action?: "reetiquete" | "isole" | "repris" | "detruit"; photo_action?: string;
    })
  | (Base & { type: "utilisation"; id: string; photo: string; famille: string; service: "midi" | "soir" })
  | (Base & {
      type: "minuteur"; id: string; type_minuteur: "refroidissement" | "remise_temperature"; plat: string;
      t_debut: number; debut_at: string; t_fin: number; fin_at: string; conforme: boolean; action?: string;
    })
  | (Base & { type: "anomalie_statut"; anomalie_id: string; statut: "traitee" | "verifiee"; commentaire?: string });

export type TypeOperation = Operation["type"];

/** Photo en attente d'envoi : `chemin` est sa place dans le stockage du serveur. */
export interface PhotoEnAttente { chemin: string; blob: Blob }

/** Une erreur qui ne disparaîtra pas en réessayant (donnée refusée par le serveur). */
export class ErreurDefinitive extends Error {}

export const nouvelId = () => crypto.randomUUID();
