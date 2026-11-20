import { describe, expect, it } from "vitest";
import { depuis, indicateursRestaurant, statutRestaurant, tabletteSilencieuse, trierRestaurants } from "./logique";
import type { EtatRestaurant } from "./types";

// 20/11/2026 15:40 à Paris = 14:40 UTC
const MAINTENANT = new Date("2026-11-20T14:40:00Z");
const ilYa = (min: number) => new Date(MAINTENANT.getTime() - min * 60_000).toISOString();
const e = (p: Partial<EtatRestaurant> = {}): EtatRestaurant => ({
  site_id: "s", nom: "R", ville: "V", taches_total: 9, taches_faites: 6, taches_en_retard: 0, taches_echues: 6,
  enceintes: 6, enceintes_relevees: 6, releves_hors_seuil: 0, friteuses: 4, friteuses_faites: 4, huile_rouges: 0, huile_trop_vieille: 0, huile_max: 16,
  livraisons: 2, livraisons_nc: 0, livraisons_non_rangees: 0, anomalies_ouvertes: 0, anomalies_a_verifier: 0, anomalies_critiques: 0,
  derniere_saisie: ilYa(10), derniere_saisie_par: "Karim", ...p,
});

describe("siège : état des restaurants", () => {
  it("vert quand tout est en ordre", () => {
    expect(statutRestaurant(e(), MAINTENANT)).toEqual({ niveau: "vert", raisons: [], silencieuse: false });
  });
  it("rouge : anomalie critique, 2 tâches en retard ou tablette silencieuse", () => {
    expect(statutRestaurant(e({ anomalies_critiques: 1 }), MAINTENANT).niveau).toBe("rouge");
    expect(statutRestaurant(e({ taches_en_retard: 2 }), MAINTENANT).niveau).toBe("rouge");
    const s = statutRestaurant(e({ derniere_saisie: ilYa(200) }), MAINTENANT);
    expect(s.niveau).toBe("rouge");
    expect(s.silencieuse).toBe(true);
    expect(s.raisons[0]).toBe("Tablette silencieuse depuis 3 h 20");
  });
  it("orange : 1 retard, température, huile, livraison, anomalie à traiter ou à vérifier", () => {
    for (const p of [{ taches_en_retard: 1 }, { releves_hors_seuil: 1 }, { huile_trop_vieille: 1 }, { huile_rouges: 1 }, { livraisons_nc: 1 }, { anomalies_ouvertes: 1 }, { anomalies_a_verifier: 1 }]) {
      expect(statutRestaurant(e(p), MAINTENANT).niveau).toBe("orange");
    }
  });
  it("les raisons graves passent en premier", () => {
    expect(statutRestaurant(e({ anomalies_ouvertes: 2, anomalies_critiques: 1, taches_en_retard: 1 }), MAINTENANT).raisons)
      .toEqual(["1 anomalie critique", "1 tâche en retard", "2 anomalies à traiter"]);
  });
  it("tablette silencieuse seulement en heures d'ouverture (10 h – 23 h, Paris)", () => {
    expect(tabletteSilencieuse(e({ derniere_saisie: ilYa(200) }), MAINTENANT)).toBe(true);
    expect(tabletteSilencieuse(e({ derniere_saisie: ilYa(170) }), MAINTENANT)).toBe(false);
    expect(tabletteSilencieuse(e({ derniere_saisie: ilYa(600) }), new Date("2026-11-20T06:00:00Z"))).toBe(false); // 7 h à Paris
    expect(tabletteSilencieuse(e({ derniere_saisie: null }), MAINTENANT)).toBe(true);
  });
  it("indicateurs de la carte", () => {
    expect(indicateursRestaurant(e()).map((i) => `${i.nom}:${i.val}:${i.niveau}`))
      .toEqual(["Températures:OK:ok", "Huile:OK · 16 %:ok", "Livraisons:2 conformes:ok", "Anomalies:0:ok"]);
    expect(indicateursRestaurant(e({ enceintes_relevees: 0, friteuses_faites: 2, livraisons: 0, anomalies_a_verifier: 1 })).map((i) => `${i.val}:${i.niveau}`))
      .toEqual(["pas encore:neutre", "2/4 faites:warn", "aucune:neutre", "1 à vérifier:warn"]);
    expect(indicateursRestaurant(e({ releves_hors_seuil: 1, huile_trop_vieille: 1, livraisons_nc: 1, anomalies_critiques: 2 })).map((i) => i.niveau))
      .toEqual(["bad", "bad", "warn", "bad"]);
  });
  it("tri : rouge, orange, vert, puis le plus de raisons, puis le nom", () => {
    const l = trierRestaurants([e({ nom: "B" }), e({ nom: "A", anomalies_ouvertes: 1 }), e({ nom: "C", anomalies_critiques: 1 }), e({ nom: "D", anomalies_ouvertes: 1, livraisons_nc: 1 })], MAINTENANT);
    expect(l.map((x) => x.nom)).toEqual(["C", "D", "A", "B"]);
  });
  it("durées lisibles", () => {
    expect(depuis(ilYa(6), MAINTENANT)).toBe("6 min");
    expect(depuis(ilYa(190), MAINTENANT)).toBe("3 h 10");
    expect(depuis(ilYa(120), MAINTENANT)).toBe("2 h");
    expect(depuis(ilYa(3000), MAINTENANT)).toBe("2 j");
  });
});
