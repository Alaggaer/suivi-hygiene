import { describe, expect, it } from "vitest";
import type { Api } from "../types";
import { avecCache, type Memoire } from "./cache";

function memoire(): Memoire { const m = new Map<string, string>(); return { get: (c) => m.get(c) ?? null, set: (c, v) => void m.set(c, v) }; }

function faux(): Api & { reseau: boolean } {
  const etat = { reseau: true };
  const panne = () => { if (!etat.reseau) throw new TypeError("Failed to fetch"); };
  return Object.assign(etat, {
    mode: "demo" as const,
    estActivee: async () => true, activer: async () => {},
    site: async () => { panne(); return { id: "s1", nom: "DALLAS", ville: "CHAMBRAY" }; },
    profils: async () => { panne(); return [{ id: "p1", nom: "Karim", role: "chef" as const }]; },
    verifierPin: async (_id: string, pin: string) => { panne(); return pin === "1234"; },
    taches: async () => { panne(); return []; },
    enceintes: async () => { panne(); return [{ id: "e1", nom: "CF+", t_max: 3 }]; },
    friteuses: async () => { panne(); return []; },
    seuilsHuile: async () => { panne(); return { orange: 20, rouge: 25 }; },
    etatFriteuses: async () => { panne(); return []; },
    fournisseurs: async () => { panne(); return []; },
    anomaliesOuvertes: async () => { panne(); return []; },
    executer: async () => {}, televerserPhoto: async () => {},
    estSiege: async () => false, tableauSiege: async () => [], fournisseursNonConformes: async () => [],
    anomaliesSiege: async () => [], siegeCorriger: async () => {}, siegeRattraper: async () => {}, equipementsSite: async () => ({ enceintes: [], friteuses: [] }), etatRestaurants: async () => [], livraisonsDuJour: async () => [], stocksMortsDuSite: async () => [], stocksMortsSiege: async () => [],
    siegeRetirerProduit: async () => {}, siegeCloreProduit: async () => {},
    planAction: async () => [], etatControles: async () => [], etatMetrologie: async () => [], ajouterAppareil: async () => {}, pmsGroupe: async () => [], typesDocuments: async () => [], documentsSite: async () => ({ documents: [], attendus: [] }), documentsArchives: async () => [],
    documentsGroupe: async () => [], siegeEnregistrerDocument: async () => {}, siegeArchiverDocument: async () => {}, etatVisites: async () => ({ eurofins_mois: 2, derniere_eurofins: null, prochaine_eurofins: null, etat_eurofins: "jamais" as const, visites: [] }),
    siegeEnregistrerVisite: async () => {}, siegeAjouterAnalyses: async () => {},
    modelesControles: async () => [], siegePlanifierAction: async () => {}, siegeEnregistrerControle: async () => {},
    nettoyageDuJour: async () => [], produitsEntretien: async () => [], planNettoyage: async () => [], nettoyageSiege: async () => [], siegeDeposerDocument: async () => "",
    alertesDuSite: async () => [], alertesSiege: async () => [], siegeCreerAlerte: async () => "", siegeCloreAlerte: async () => {},
    sitesGestion: async () => [], referentielSite: async () => ({ enceintes: [], friteuses: [], modeles: [] }), fournisseursGestion: async () => [],
    siegeEnregistrer: async () => {}, siegeCreerRestaurant: async () => "", employesSite: async () => [], siegeAjouterEmploye: async () => "",
    siegeNouveauPin: async () => "", siegeModifierEmploye: async () => {}, tablettes: async () => [], creerTablette: async () => {}, motDePasseTablette: async () => {}, historiqueSite: async () => [], siegeChangerStatut: async () => {}, urlPhoto: async () => "",
    preuvesJour: async () => ({ taches: [], releves: [], huiles: [], livraisons: [], produits: [], anomalies: [] }),
  });
}

describe("lectures hors ligne", () => {
  it("ressert la dernière réponse quand le réseau est coupé", async () => {
    const f = faux(), api = avecCache(f, memoire());
    expect(await api.enceintes()).toHaveLength(1);
    f.reseau = false;
    expect(await api.enceintes()).toEqual([{ id: "e1", nom: "CF+", t_max: 3 }]);
  });
  it("sans réponse connue, l'erreur remonte", async () => {
    const f = faux(), api = avecCache(f, memoire());
    f.reseau = false;
    await expect(api.site()).rejects.toThrow();
  });
  it("une erreur du serveur (pas du réseau) n'est pas masquée par le cache", async () => {
    const f = faux(), api = avecCache(f, memoire());
    await api.enceintes();
    f.enceintes = async () => { throw new Error("permission denied for table enceintes"); };
    await expect(avecCache(f, memoire()).enceintes()).rejects.toThrow("permission");
  });
});

describe("PIN hors ligne", () => {
  it("reconnaît la personne hors ligne après une première connexion en ligne", async () => {
    const f = faux(), m = memoire(), api = avecCache(f, m);
    expect(await api.verifierPin("p1", "1234")).toBe(true);
    f.reseau = false;
    expect(await api.verifierPin("p1", "1234")).toBe(true);
    expect(await api.verifierPin("p1", "0000")).toBe(false);
  });
  it("refuse hors ligne une personne jamais connectée sur cette tablette", async () => {
    const f = faux(), api = avecCache(f, memoire());
    f.reseau = false;
    await expect(api.verifierPin("p1", "1234")).rejects.toThrow();
  });
  it("ne garde jamais le PIN en clair", async () => {
    const f = faux(), m = memoire(), api = avecCache(f, m);
    await api.verifierPin("p1", "1234");
    const valeurs: string[] = [];
    const m2: Memoire = { get: m.get, set: (c, v) => { valeurs.push(v); m.set(c, v); } };
    await avecCache(f, m2).verifierPin("p1", "1234");
    expect(valeurs.join()).not.toContain("1234");
  });
});
