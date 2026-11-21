import { nouvelId, useEnregistrer } from "./contexte";
import { duree } from "./ui/outils";
import type { Minuteur } from "./minuteurs";

/**
 * « C'est rangé » : enregistre le rangement d'une livraison, depuis le minuteur du bandeau ou depuis la liste des livraisons.
 * Rangée après le délai du minuteur : une anomalie mineure « rangée en retard » est créée.
 */
export function useRangerLivraison(minuteurs: Minuteur[], retirer: (id: string) => void) {
  const enregistrer = useEnregistrer();
  return async (livraisonId: string, fournisseur: string) => {
    const m = minuteurs.find((x) => x.type === "rangement" && x.ref === livraisonId);
    await enregistrer({ type: "livraison_rangee", livraison_id: livraisonId });
    if (m) {
      const ecoule = Date.now() - m.debut;
      if (ecoule > m.duree) await enregistrer({ type: "anomalies", lignes: [{
        id: nouvelId(), source: "livraison", ref_id: livraisonId, categorie: "Livraison", gravite: "mineure",
        titre: `Livraison rangée en retard (${duree(ecoule)}) · ${fournisseur}`,
      }] });
      retirer(m.id);
    }
  };
}
