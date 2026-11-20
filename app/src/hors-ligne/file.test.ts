import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { ErreurDefinitive, type Operation } from "../operations";
import { FileEnvoi, type Envoyeur } from "./file";
import { stockageIndexedDB, stockageMemoire, type Stockage } from "./stockage";

const op = (id: string): Operation => ({ type: "terminer_tache", tache_id: id, par: "p1", par_nom: "Karim", at_client: "2026-11-20T10:00:00Z" });

/** Serveur de test : enregistre ce qu'il reçoit, et peut échouer à la demande. */
function serveur() {
  const recu: string[] = [];
  const photos: string[] = [];
  let panne: "aucune" | "reseau" = "aucune";
  const refuser = new Set<string>();
  const envoyeur: Envoyeur = {
    async televerserPhoto(chemin) { if (panne === "reseau") throw new TypeError("Failed to fetch"); photos.push(chemin); },
    async executer(o) {
      if (panne === "reseau") throw new TypeError("Failed to fetch");
      const id = o.type === "terminer_tache" ? o.tache_id : o.type;
      if (refuser.has(id)) throw new ErreurDefinitive("violates check constraint");
      recu.push(id);
    },
  };
  return { envoyeur, recu, photos, couper: () => { panne = "reseau"; }, retablir: () => { panne = "aucune"; }, refuser: (id: string) => refuser.add(id) };
}

function suite(nom: string, fabrique: () => Stockage) {
  describe(`file d'envoi (${nom})`, () => {
    it("envoie dans l'ordre puis vide la file", async () => {
      const s = serveur(), st = fabrique(), f = new FileEnvoi(st, s.envoyeur);
      await f.ajouter(op("a")); await f.ajouter(op("b")); await f.ajouter(op("c"));
      await f.vider();
      expect(s.recu).toEqual(["a", "b", "c"]);
      expect(await st.lister()).toEqual([]);
    });

    it("hors ligne : garde tout, puis envoie au retour du réseau sans rien perdre ni doubler", async () => {
      const s = serveur(), st = fabrique(), f = new FileEnvoi(st, s.envoyeur);
      s.couper();
      await f.ajouter(op("a")); await f.ajouter(op("b"));
      await f.vider();
      expect(s.recu).toEqual([]);
      const enAttente = await st.lister();
      expect(enAttente.map((e) => e.statut)).toEqual(["attente", "attente"]);
      expect(enAttente[0].tentatives).toBeGreaterThan(0);
      s.retablir();
      await f.vider();
      expect(s.recu).toEqual(["a", "b"]);
      expect(await st.lister()).toEqual([]);
    });

    it("met de côté une opération refusée et continue avec les suivantes", async () => {
      const s = serveur(), st = fabrique(), f = new FileEnvoi(st, s.envoyeur);
      s.refuser("b");
      await f.ajouter(op("a")); await f.ajouter(op("b")); await f.ajouter(op("c"));
      await f.vider();
      expect(s.recu).toEqual(["a", "c"]);
      const reste = await st.lister();
      expect(reste).toHaveLength(1);
      expect(reste[0].statut).toBe("bloquee");
      expect(reste[0].erreur).toContain("constraint");
    });

    it("envoie les photos avant l'opération, et les efface de la tablette après", async () => {
      const s = serveur(), st = fabrique(), f = new FileEnvoi(st, s.envoyeur);
      await f.ajouter(op("a"), [{ chemin: "site/2026-11-20/x.webp", blob: new Blob(["img"]) }]);
      await f.vider();
      expect(s.photos).toEqual(["site/2026-11-20/x.webp"]);
      expect(s.recu).toEqual(["a"]);
      expect(await st.photo("site/2026-11-20/x.webp")).toBeUndefined();
    });

    it("deux envois lancés en même temps n'envoient qu'une fois", async () => {
      const s = serveur(), st = fabrique(), f = new FileEnvoi(st, s.envoyeur);
      await st.ajouter(op("a"), []); await st.ajouter(op("b"), []);
      await Promise.all([f.vider(), f.vider(), f.vider()]);
      expect(s.recu).toEqual(["a", "b"]);
    });

    it("informe l'écran du nombre d'envois en attente", async () => {
      const s = serveur(), st = fabrique(), f = new FileEnvoi(st, s.envoyeur);
      const vus: number[] = [];
      f.abonner((e) => vus.push(e.attente));
      s.couper();
      await f.ajouter(op("a"));
      await f.vider();
      expect(vus[vus.length - 1]).toBe(1);
      s.retablir();
      await f.vider();
      expect(vus[vus.length - 1]).toBe(0);
    });
  });
}

suite("mémoire", stockageMemoire);
suite("IndexedDB", () => stockageIndexedDB(new IDBFactory()));

describe("IndexedDB : persistance", () => {
  it("retrouve la file après un redémarrage de l'app", async () => {
    const idb = new IDBFactory();
    const s = serveur(); s.couper();
    await new FileEnvoi(stockageIndexedDB(idb), s.envoyeur).ajouter(op("a"));
    // « redémarrage » : nouvelle connexion à la même base
    const f2 = new FileEnvoi(stockageIndexedDB(idb), s.envoyeur);
    s.retablir();
    await f2.vider();
    expect(s.recu).toEqual(["a"]);
  });
});
