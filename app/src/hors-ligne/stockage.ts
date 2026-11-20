import type { Operation, PhotoEnAttente } from "../operations";

export interface Entree {
  cle: number;              // ordre d'arrivée
  op: Operation;
  photos: string[];         // chemins des photos à envoyer avant l'opération
  tentatives: number;
  statut: "attente" | "bloquee";
  erreur?: string;
}

/** Où la file est conservée : IndexedDB sur la tablette (survit au rechargement et à l'extinction), mémoire en test. */
export interface Stockage {
  ajouter(op: Operation, photos: PhotoEnAttente[]): Promise<number>;
  lister(): Promise<Entree[]>;
  maj(e: Entree): Promise<void>;
  retirer(cle: number): Promise<void>;
  photo(chemin: string): Promise<Blob | undefined>;
}

export function stockageMemoire(): Stockage {
  const entrees = new Map<number, Entree>();
  const photos = new Map<string, Blob>();
  let suivant = 1;
  return {
    async ajouter(op, ph) {
      const cle = suivant++;
      ph.forEach((p) => photos.set(p.chemin, p.blob));
      entrees.set(cle, { cle, op, photos: ph.map((p) => p.chemin), tentatives: 0, statut: "attente" });
      return cle;
    },
    async lister() { return [...entrees.values()].sort((a, b) => a.cle - b.cle).map((e) => structuredClone(e)); },
    async maj(e) { if (entrees.has(e.cle)) entrees.set(e.cle, structuredClone(e)); },
    async retirer(cle) { entrees.get(cle)?.photos.forEach((c) => photos.delete(c)); entrees.delete(cle); },
    async photo(chemin) { return photos.get(chemin); },
  };
}

const NOM_BASE = "suivi-hygiene";
function ouvrir(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = idb.open(NOM_BASE, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("file", { keyPath: "cle", autoIncrement: true });
      r.result.createObjectStore("photos", { keyPath: "chemin" });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function fin(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export function stockageIndexedDB(idb: IDBFactory = indexedDB): Stockage {
  const db = ouvrir(idb);
  return {
    async ajouter(op, ph) {
      // Opération et photos écrites dans la même transaction : tout ou rien.
      const tx = (await db).transaction(["file", "photos"], "readwrite");
      ph.forEach((p) => tx.objectStore("photos").put(p));
      const cle = await req(tx.objectStore("file").add({ op, photos: ph.map((p) => p.chemin), tentatives: 0, statut: "attente" }));
      await fin(tx);
      return cle as number;
    },
    async lister() {
      const tx = (await db).transaction("file", "readonly");
      return (await req(tx.objectStore("file").getAll())) as Entree[];
    },
    async maj(e) {
      const tx = (await db).transaction("file", "readwrite");
      tx.objectStore("file").put(e);
      await fin(tx);
    },
    async retirer(cle) {
      const tx = (await db).transaction(["file", "photos"], "readwrite");
      const e = (await req(tx.objectStore("file").get(cle))) as Entree | undefined;
      e?.photos.forEach((c) => tx.objectStore("photos").delete(c));
      tx.objectStore("file").delete(cle);
      await fin(tx);
    },
    async photo(chemin) {
      const tx = (await db).transaction("photos", "readonly");
      const p = (await req(tx.objectStore("photos").get(chemin))) as PhotoEnAttente | undefined;
      return p?.blob;
    },
  };
}
