import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Api, Profil, Site } from "./types";
import { FileEnvoi, type EtatFile } from "./hors-ligne/file";
import type { Entree } from "./hors-ligne/stockage";
import type { Operation, PhotoEnAttente } from "./operations";
import { nouvelId } from "./operations";

interface Contexte { api: Api; file: FileEnvoi; site: Site; profil: Profil }
const Ctx = createContext<Contexte | null>(null);

export function ContexteProvider({ valeur, children }: { valeur: Contexte; children: ReactNode }) {
  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}
export function useContexte(): Contexte {
  const c = useContext(Ctx);
  if (!c) throw new Error("useContexte hors du fournisseur");
  return c;
}

/** Raccourci pour les écrans : ajoute une opération signée par la personne connectée. */
type SansSignature<T> = T extends unknown ? Omit<T, "par" | "par_nom" | "at_client"> : never;
export function useEnregistrer() {
  const { file, profil } = useContexte();
  return (op: SansSignature<Operation>, photos: PhotoEnAttente[] = []) =>
    file.ajouter({ ...op, par: profil.id, par_nom: profil.nom, at_client: new Date().toISOString() } as Operation, photos);
}

/** État de la file (en attente, bloquées) et son contenu, pour l'affichage immédiat des saisies pas encore envoyées. */
export function useFile(file: FileEnvoi) {
  const [etat, setEtat] = useState<EtatFile>({ attente: 0, bloquees: 0, envoiEnCours: false });
  const [entrees, setEntrees] = useState<Entree[]>([]);
  useEffect(() => file.abonner((e, l) => { setEtat(e); setEntrees(l); }), [file]);
  return { etat, entrees };
}

export { nouvelId };
