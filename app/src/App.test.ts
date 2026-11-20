import { describe, expect, it } from "vitest";
import { appliquerEnAttente } from "./App";
import type { Entree } from "./hors-ligne/stockage";

const base = { par: "p1", par_nom: "Karim", at_client: "2026-11-20T10:00:00Z" };
const tache = { id: "t1", type: "releves" as const, titre: "Relevé", echeance: "2026-11-20T10:30:00Z", faite_at: null, faite_par_nom: null, escalade: 0 };

describe("saisies en attente affichées tout de suite", () => {
  it("coche la tâche et liste l'anomalie avant l'envoi au serveur", () => {
    const entrees: Entree[] = [
      { cle: 1, statut: "attente", tentatives: 0, photos: [], op: { ...base, type: "releves", tache_id: "t1", lignes: [] } },
      { cle: 2, statut: "attente", tentatives: 0, photos: [], op: { ...base, type: "anomalies", lignes: [{ id: "a9", source: "releve", categorie: "Température", gravite: "majeure", titre: "CF à +6" }] } },
    ];
    const r = appliquerEnAttente([tache], [], entrees);
    expect(r.taches[0].faite_at).toBe(base.at_client);
    expect(r.taches[0].faite_par_nom).toBe("Karim");
    expect(r.anomalies[0]).toMatchObject({ id: "a9", enAttente: true });
  });
  it("ne double pas une anomalie déjà reçue par le serveur", () => {
    const entrees: Entree[] = [{ cle: 1, statut: "attente", tentatives: 0, photos: [], op: { ...base, type: "anomalies", lignes: [{ id: "a9", source: "x", categorie: "x", gravite: "mineure", titre: "x" }] } }];
    const r = appliquerEnAttente([], [{ id: "a9", titre: "x", categorie: "x", gravite: "mineure", statut: "ouverte", cree_at: base.at_client }], entrees);
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0].enAttente).toBeUndefined();
  });
  it("applique tout de suite un changement de statut, et retire une anomalie vérifiée", () => {
    const a = { id: "a1", titre: "x", categorie: "x", gravite: "mineure" as const, statut: "ouverte" as const, cree_at: base.at_client };
    const b = { ...a, id: "a2", statut: "traitee" as const };
    const entrees: Entree[] = [
      { cle: 1, statut: "attente", tentatives: 0, photos: [], op: { ...base, type: "anomalie_statut", anomalie_id: "a1", statut: "traitee" } },
      { cle: 2, statut: "attente", tentatives: 0, photos: [], op: { ...base, type: "anomalie_statut", anomalie_id: "a2", statut: "verifiee" } },
    ];
    const r = appliquerEnAttente([], [a, b], entrees);
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0]).toMatchObject({ id: "a1", statut: "traitee", enAttente: true });
  });
});
