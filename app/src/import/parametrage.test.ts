import { describe, expect, it } from "vitest";
import { heure, jours, lireClasseur, nombre, planifier, produits, type Classeur, type Existant } from "./parametrage";

const classeur = (o: Partial<Record<string, unknown[][]>>): Classeur => [
  { sheet: "Mode d'emploi", data: [["Paramétrage"]] },
  { sheet: "Restaurants", data: o.Restaurants ?? [["Restaurant", "Ville", "Responsable de site", "Ouverture", "Début service soir", "Modèle testeur d'huile"]] },
  { sheet: "Enceintes", data: o.Enceintes ?? [["Restaurant", "Enceinte", "Type", "T° max (°C)", "Capteur Traqfood", "Remarques"]] },
  { sheet: "Friteuses", data: o.Friteuses ?? [["Restaurant", "Friteuse", "Capacité (L)", "Remarques"]] },
  { sheet: "Employés", data: o["Employés"] ?? [["Restaurant", "Prénom", "Nom", "Rôle", "Remarques"]] },
  { sheet: "Fournisseurs", data: o.Fournisseurs ?? [["Fournisseur", "Produits livrés", "Livre de la viande", "Jours de livraison", "Contact"]] },
] as Classeur;

describe("lecture des cellules", () => {
  it("heures", () => {
    expect(heure("09H")).toBe("09:00");
    expect(heure("18h45")).toBe("18:45");
    expect(heure("9:30")).toBe("09:30");
    expect(heure(0.78125)).toBe("18:45");
    expect(heure(new Date(Date.UTC(1899, 11, 30, 11, 30)))).toBe("11:30");
    expect(heure("midi")).toBeNull();
    expect(heure("25h")).toBeNull();
  });
  it("nombres", () => {
    expect(nombre("-18")).toBe(-18);
    expect(nombre("3,5 °C")).toBe(3.5);
    expect(nombre("+4°C")).toBe(4);
    expect(nombre("25 L")).toBe(25);
    expect(nombre("")).toBeNull();
    expect(nombre("environ 4")).toBeNull();
  });
  it("produits et jours", () => {
    expect(produits("Frais, Surgelé")).toEqual(["frais", "surgele"]);
    expect(produits("Sec")).toEqual(["sec"]);
    expect(produits("")).toBeNull();
    expect(produits("Boissons")).toBeUndefined();
    expect(jours("lundi, jeudi")).toEqual([1, 4]);
    expect(jours("Mar Sam")).toEqual([2, 6]);
    expect(jours("mardi au samedi")).toEqual([2, 3, 4, 5, 6]);
    expect(jours("Tous les jours")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(jours("samedi")).toEqual([6]);
    expect(jours("parfois")).toBeUndefined();
  });
});

describe("lecture du classeur", () => {
  it("lit les onglets, refuse les lignes impossibles et dit pourquoi", () => {
    const m = lireClasseur(classeur({
      Restaurants: [["Restaurant", "Ville", "Responsable de site", "Ouverture", "Début service soir"],
        ["Atlanta", "Langueux", "David", "09H", "18h45"], ["BOSTON", "RENNES", null, "9h30", "bientôt"], ["atlanta", "X", null, null, null]],
      Enceintes: [["Restaurant", "Enceinte", "Type", "T° max (°C)"],
        ["ATLANTA", "Chambre froide positive", "Chambre froide positive", 3], ["ATLANTA", "Chambre froide négative", "Chambre froide négative", -4],
        ["ATLANTA", "Congélateur frites", "Congélateur", "-18"], ["PARIS", "Frigo", "Frigo", 4], ["BOSTON", "Frigo bar", "Frigo", null], [null, null, null, null]],
      Friteuses: [["Restaurant", "Friteuse", "Capacité (L)"], ["ATLANTA", "Friteuse 1", 25], ["BOSTON", "Friteuse 1", null], ["BOSTON", "Friteuse 2", 250]],
      "Employés": [["Restaurant", "Prénom", "Nom", "Rôle"], ["ATLANTA", "Nora", "Benali", "Chef"], ["ATLANTA", "Tom", null, "Plongeur"]],
      Fournisseurs: [["Fournisseur", "Produits livrés", "Livre de la viande", "Jours de livraison"], ["Beauvallet", "Frais", "Oui", "mardi, vendredi"], ["SYSCO", "Boissons", null, null]],
    }));
    expect(m.restaurants.map((r) => [r.nom, r.ouverture, r.soir])).toEqual([["ATLANTA", "09:00", "18:45"], ["BOSTON", "09:30", null]]);
    expect(m.enceintes.map((e) => [e.nom, e.t_max, e.ordre])).toEqual([["Chambre froide positive", 3, 1], ["Congélateur frites", -18, 2]]);
    expect(m.friteuses).toEqual([{ restaurant: "ATLANTA", nom: "Friteuse 1", litres: 25 }]);
    expect(m.employes).toEqual([
      { restaurant: "ATLANTA", nom: "Nora Benali", role: "chef" },
      { restaurant: "ATLANTA", nom: "David", role: "responsable" },   // depuis l'onglet Restaurants
    ]);
    expect(m.fournisseurs).toEqual([
      { nom: "BEAUVALLET", produits: ["frais"], viande: true, jours: [2, 5] },
      { nom: "SYSCO", produits: null, viande: null, jours: null },
    ]);
    const msg = m.problemes.map((p) => `${p.onglet}:${p.ligne}:${p.bloquant ? "B" : "i"}:${p.message}`);
    expect(msg).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Restaurants:3:i:Heure du service du soir illisible/),
      expect.stringMatching(/^Restaurants:4:B:ATLANTA apparaît deux fois/),
      expect.stringMatching(/^Enceintes:3:B:.*-4 °C impossible pour du froid négatif/),
      expect.stringMatching(/^Enceintes:5:B:Restaurant « PARIS » absent/),
      expect.stringMatching(/^Enceintes:6:B:.*température maximale manquante/),
      expect.stringMatching(/^Friteuses:3:i:.*capacité manquante/),
      expect.stringMatching(/^Friteuses:4:B:.*250 L impossible/),
      expect.stringMatching(/^Employés:3:B:.*rôle « Plongeur » inconnu/),
      expect.stringMatching(/^Fournisseurs:3:i:SYSCO : produits « Boissons »/),
    ]));
    expect(m.problemes.length).toBe(9);
  });
  it("signale une colonne ou un onglet manquant", () => {
    const m = lireClasseur([{ sheet: "Restaurants", data: [["Restaurant", "Ville"]] }]);
    expect(m.problemes.some((p) => p.message.includes("Ouverture") && p.bloquant)).toBe(true);
    expect(m.problemes.some((p) => p.onglet === "Enceintes" && p.message === "Onglet introuvable")).toBe(true);
  });
});

describe("plan d'import", () => {
  const ex: Existant = {
    sites: [{ id: "s1", nom: "ATLANTA", ville: "LANGUÉUX", ouverture: "09:00:00", service_soir: "18:30:00", actif: true }],
    enceintes: { s1: [{ id: "e1", site_id: "s1", nom: "Chambre froide positive", t_max: 3, ordre: 1, actif: true },
                      { id: "e2", site_id: "s1", nom: "Vieux frigo", t_max: 4, ordre: 2, actif: true }] },
    friteuses: { s1: [{ id: "f1", site_id: "s1", nom: "Friteuse 1", litres: 20, actif: true }] },
    employes: { s1: [{ id: "p1", nom: "Nora", role: "chef", actif: true }] },
    fournisseurs: [{ id: "x1", nom: "BEAUVALLET", viande: true, produits: ["frais"], jours_livraison: null, actif: true },
                   { id: "x2", nom: "SYSCO", viande: false, produits: ["frais"], jours_livraison: [1], actif: true }],
  };
  const m = lireClasseur(classeur({
    Restaurants: [["Restaurant", "Ville", "Responsable de site", "Ouverture", "Début service soir"], ["ATLANTA", "LANGUEUX", null, "09h", "18h45"], ["BOSTON", "RENNES", null, null, null]],
    Enceintes: [["Restaurant", "Enceinte", "Type", "T° max (°C)"], ["ATLANTA", "chambre froide POSITIVE", "Chambre froide positive", 3],
      ["ATLANTA", "Frigo desserts", "Frigo", 4], ["BOSTON", "Frigo bar", "Frigo", 4]],
    Friteuses: [["Restaurant", "Friteuse", "Capacité (L)"], ["ATLANTA", "Friteuse 1", 25]],
    "Employés": [["Restaurant", "Prénom", "Nom", "Rôle"], ["ATLANTA", "Nora", "Benali", "Chef"], ["BOSTON", "Léa", null, "Équipe"]],
    Fournisseurs: [["Fournisseur", "Produits livrés", "Livre de la viande", "Jours de livraison"], ["BEAUVALLET", null, null, "mardi"], ["SYSCO", "Frais", null, "lundi"], ["METRO", "Sec", "Non", null]],
  }));
  const p = planifier(m, ex);
  const libelles = p.actions.map((a) => a.libelle);

  it("crée ce qui manque, modifie ce qui a changé, ne touche pas au reste", () => {
    expect(libelles).toEqual([
      "ATLANTA : service du soir 18:45",
      "Nouveau restaurant BOSTON (RENNES)",
      "ATLANTA · nouvelle enceinte Frigo desserts (max 4 °C)",
      "ATLANTA · Friteuse 1 : 20 → 25 L",
      "BOSTON · nouvelle enceinte Frigo bar (max 4 °C)",
      "BOSTON · nouvel employé Léa (équipe)",
      "BEAUVALLET : jours de livraison",
      "Nouveau fournisseur METRO",
    ]);
    expect(p.inchanges).toBe(3);   // chambre froide (nom en casse différente), Nora (prénom déjà enregistré), SYSCO
  });
  it("ne supprime rien : ce qui manque dans le tableau est seulement signalé", () => {
    expect(p.nonRepris).toEqual(["ATLANTA · enceinte Vieux frigo"]);
  });
  it("une case vide ne change rien, et un second import identique ne fait plus rien", () => {
    const b = p.actions.find((a) => a.t === "fournisseur" && a.ligne.nom === "BEAUVALLET");
    expect(b && b.t === "fournisseur" && b.ligne).toMatchObject({ viande: true, produits: ["frais"], jours_livraison: [2] });
    const apres: Existant = {
      sites: [{ ...ex.sites[0], service_soir: "18:45:00" }, { id: "s2", nom: "BOSTON", ville: "RENNES", ouverture: "09:00:00", service_soir: "18:45:00", actif: true }],
      enceintes: { s1: [...ex.enceintes.s1, { id: "e3", site_id: "s1", nom: "Frigo desserts", t_max: 4, ordre: 2, actif: true }],
                   s2: [{ id: "e4", site_id: "s2", nom: "Frigo bar", t_max: 4, ordre: 1, actif: true }] },
      friteuses: { s1: [{ ...ex.friteuses.s1[0], litres: 25 }] },
      employes: { s1: ex.employes.s1, s2: [{ id: "p2", nom: "Léa", role: "equipe", actif: true }] },
      fournisseurs: [{ ...ex.fournisseurs[0], jours_livraison: [2] }, ex.fournisseurs[1], { id: "x3", nom: "METRO", viande: false, produits: ["sec"], jours_livraison: null, actif: true }],
    };
    expect(planifier(m, apres).actions).toEqual([]);
  });
});
