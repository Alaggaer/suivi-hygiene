import { ErreurDefinitive, type Operation, type PhotoEnAttente } from "../operations";
import type { Entree, Stockage } from "./stockage";

/** Ce dont la file a besoin pour envoyer : implémenté par le serveur réel et par le serveur simulé. */
export interface Envoyeur {
  televerserPhoto(chemin: string, blob: Blob): Promise<void>;
  executer(op: Operation): Promise<void>;
}

export interface EtatFile { attente: number; bloquees: number; envoiEnCours: boolean; derniereErreur?: string }

/**
 * File d'envoi : chaque saisie est d'abord écrite sur la tablette, puis envoyée dans l'ordre.
 * - Erreur passagère (réseau, serveur indisponible) : on s'arrête et on réessaiera plus tard, l'ordre est gardé.
 * - Erreur définitive (donnée refusée) : l'opération est mise de côté (« bloquée ») et la suite continue.
 */
export class FileEnvoi {
  private enCours: Promise<void> | null = null;
  private etat: EtatFile = { attente: 0, bloquees: 0, envoiEnCours: false };
  private abonnes = new Set<(e: EtatFile, entrees: Entree[]) => void>();
  private entrees: Entree[] = [];

  constructor(private stockage: Stockage, private envoyeur: Envoyeur) {}

  abonner(f: (e: EtatFile, entrees: Entree[]) => void) { this.abonnes.add(f); f(this.etat, this.entrees); return () => { this.abonnes.delete(f); }; }

  private async publier(patch: Partial<EtatFile> = {}) {
    this.entrees = await this.stockage.lister();
    this.etat = {
      ...this.etat, ...patch,
      attente: this.entrees.filter((e) => e.statut === "attente").length,
      bloquees: this.entrees.filter((e) => e.statut === "bloquee").length,
    };
    this.abonnes.forEach((f) => f(this.etat, this.entrees));
  }

  /** Enregistre sur la tablette (rapide, marche hors ligne), puis lance l'envoi sans l'attendre. */
  async ajouter(op: Operation, photos: PhotoEnAttente[] = []): Promise<void> {
    await this.stockage.ajouter(op, photos);
    await this.publier();
    void this.vider();
  }

  /** Envoie tout ce qui peut l'être. Un seul envoi à la fois : un appel pendant un envoi attend sa fin puis relance. */
  vider(): Promise<void> {
    if (this.enCours) return this.enCours.then(() => this.vider());
    this.enCours = this.envoyer().finally(() => { this.enCours = null; });
    return this.enCours;
  }

  private async envoyer(): Promise<void> {
    await this.publier({ envoiEnCours: true });
    try {
      for (const e of await this.stockage.lister()) {
        if (e.statut !== "attente") continue;
        try {
          for (const chemin of e.photos) {
            const blob = await this.stockage.photo(chemin);
            if (blob) await this.envoyeur.televerserPhoto(chemin, blob);
          }
          await this.envoyeur.executer(e.op);
          await this.stockage.retirer(e.cle);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (err instanceof ErreurDefinitive) {
            await this.stockage.maj({ ...e, tentatives: e.tentatives + 1, statut: "bloquee", erreur: message });
            continue;
          }
          await this.stockage.maj({ ...e, tentatives: e.tentatives + 1, erreur: message });
          await this.publier({ derniereErreur: message });
          return; // passager : on garde l'ordre, nouvel essai plus tard
        }
      }
      await this.publier({ derniereErreur: undefined });
    } finally {
      await this.publier({ envoiEnCours: false });
    }
  }

  /** Remet une opération bloquée dans la file (après correction côté serveur, par ex.). */
  async relancer(cle: number) {
    const e = (await this.stockage.lister()).find((x) => x.cle === cle);
    if (e) { await this.stockage.maj({ ...e, statut: "attente", erreur: undefined }); await this.publier(); void this.vider(); }
  }
}
