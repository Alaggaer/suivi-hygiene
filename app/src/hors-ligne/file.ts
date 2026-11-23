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
    this.vider().catch(() => { /* nouvel essai au prochain passage */ });
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
      // Identifiants des saisies refusées : une saisie qui en dépend (anomalie d'une livraison, rangement…)
      // reste de côté avec elle au lieu de partir seule ou d'échouer à son tour.
      const refusees = new Set<string>();
      for (const e of await this.stockage.lister()) {
        if (e.statut === "bloquee") { identifiants(e.op).forEach((id) => refusees.add(id)); continue; }
        if (e.statut !== "attente") continue;
        const parent = [...refusees].find((id) => dependDe(e.op, id));
        if (parent) {
          await this.stockage.maj({ ...e, statut: "bloquee", erreur: `${DEPENDANCE} : elle partira ou sera abandonnée avec elle` });
          identifiants(e.op).forEach((id) => refusees.add(id));
          continue;
        }
        try {
          for (const chemin of e.photos) {
            const blob = await this.stockage.photo(chemin);
            if (!blob) throw new ErreurDefinitive("Photo introuvable sur la tablette (effacée par le navigateur ?) : refaites la saisie");
            await this.envoyeur.televerserPhoto(chemin, blob);
          }
          await this.envoyeur.executer(e.op);
          await this.stockage.retirer(e.cle);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (err instanceof ErreurDefinitive) {
            await this.stockage.maj({ ...e, tentatives: e.tentatives + 1, statut: "bloquee", erreur: message });
            identifiants(e.op).forEach((id) => refusees.add(id));
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

  /** Saisies mises de côté parce qu'elles dépendent de celle-ci (et, en cascade, de celles-là). */
  private async dependantes(cle: number): Promise<Entree[]> {
    const toutes = await this.stockage.lister();
    const racine = toutes.find((x) => x.cle === cle);
    if (!racine) return [];
    const ids = new Set(identifiants(racine.op)), r: Entree[] = [];
    for (const x of toutes) {
      if (x.cle === cle || x.statut !== "bloquee" || !x.erreur?.startsWith(DEPENDANCE)) continue;
      if ([...ids].some((id) => dependDe(x.op, id))) { r.push(x); identifiants(x.op).forEach((id) => ids.add(id)); }
    }
    return r;
  }

  /** Abandonne une saisie refusée (et ses photos), avec celles qui en dépendent : elles ne seront jamais envoyées. */
  async abandonner(cle: number) {
    const e = (await this.stockage.lister()).find((x) => x.cle === cle);
    if (!e || e.statut !== "bloquee") return;
    for (const d of await this.dependantes(cle)) await this.stockage.retirer(d.cle);
    await this.stockage.retirer(cle); await this.publier();
  }

  /** Remet une opération bloquée dans la file (avec celles qui en dépendent), après correction côté serveur par ex. */
  async relancer(cle: number) {
    const e = (await this.stockage.lister()).find((x) => x.cle === cle);
    if (!e) return;
    for (const d of await this.dependantes(cle)) await this.stockage.maj({ ...d, statut: "attente", erreur: undefined });
    await this.stockage.maj({ ...e, statut: "attente", erreur: undefined }); await this.publier(); this.vider().catch(() => {});
  }
}

const DEPENDANCE = "Dépend d'une saisie refusée";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Identifiants créés par une saisie (la sienne et ceux de ses lignes). */
function identifiants(op: Operation): string[] {
  const o = op as unknown as { id?: unknown; lignes?: { id?: unknown }[] };
  return [o.id, ...(Array.isArray(o.lignes) ? o.lignes.map((l) => l.id) : [])].filter((x): x is string => typeof x === "string" && UUID.test(x));
}
/** Une saisie dépend d'une autre si elle cite un de ses identifiants (hors les siens propres). */
function dependDe(op: Operation, id: string): boolean {
  return !identifiants(op).includes(id) && JSON.stringify(op).includes(id);
}
