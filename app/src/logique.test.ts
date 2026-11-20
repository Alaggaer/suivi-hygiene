import { describe, expect, it } from "vitest";
import {
  cheminPhoto, etatTache, MIN, niveauEscalade, niveauHuile, service, tachesALheure,
  temperatureConforme, temperaturesLivraisonOk, trierTaches,
} from "./logique";

const T0 = Date.parse("2026-11-20T10:00:00Z"); // 11:00 à Paris
const iso = (ms: number) => new Date(ms).toISOString();

describe("tâches du jour", () => {
  it("donne l'état selon l'échéance", () => {
    expect(etatTache({ echeance: iso(T0 - MIN), faite_at: null }, T0)).toBe("retard");
    expect(etatTache({ echeance: iso(T0 + 15 * MIN), faite_at: null }, T0)).toBe("bientot");
    expect(etatTache({ echeance: iso(T0 + 16 * MIN), faite_at: null }, T0)).toBe("avenir");
    expect(etatTache({ echeance: iso(T0 - MIN), faite_at: iso(T0) }, T0)).toBe("faite");
  });
  it("trie retards, proches, à venir, faites", () => {
    const l = trierTaches([
      { id: "faite", echeance: iso(T0 - 90 * MIN), faite_at: iso(T0) },
      { id: "avenir", echeance: iso(T0 + 60 * MIN), faite_at: null },
      { id: "retard", echeance: iso(T0 - 5 * MIN), faite_at: null },
      { id: "bientot", echeance: iso(T0 + 5 * MIN), faite_at: null },
    ], T0);
    expect(l.map((t) => t.id)).toEqual(["retard", "bientot", "avenir", "faite"]);
  });
  it("relance le chef à 30 min et le responsable à 2 h", () => {
    expect(niveauEscalade(29 * MIN)).toBe("aucune");
    expect(niveauEscalade(30 * MIN)).toBe("chef");
    expect(niveauEscalade(120 * MIN)).toBe("responsable");
  });
  it("compte les tâches faites à l'heure seulement", () => {
    expect(tachesALheure([
      { echeance: iso(T0), faite_at: iso(T0 - MIN) },
      { echeance: iso(T0), faite_at: iso(T0 + MIN) },
      { echeance: iso(T0), faite_at: null },
    ])).toBe(1);
  });
});

describe("seuils", () => {
  it("températures positives et négatives", () => {
    expect(temperatureConforme(3, 3)).toBe(true);
    expect(temperatureConforme(3.1, 3)).toBe(false);
    expect(temperatureConforme(-20, -18)).toBe(true);
    expect(temperatureConforme(-15, -18)).toBe(false);
  });
  it("huile : vert, orange, rouge à 25 %", () => {
    const s = { orange: 20, rouge: 25 };
    expect(niveauHuile(19.5, s)).toBe("ok");
    expect(niveauHuile(20, s)).toBe("warn");
    expect(niveauHuile(24.9, s)).toBe("warn");
    expect(niveauHuile(25, s)).toBe("bad");
  });
  it("livraison : surgelé facultatif, chaque seuil vérifié", () => {
    expect(temperaturesLivraisonOk({ camion: 3, frais: 4 })).toBe(true);
    expect(temperaturesLivraisonOk({ camion: 5, frais: 2 })).toBe(false);
    expect(temperaturesLivraisonOk({ camion: 2, frais: 2, surgele: -12 })).toBe(false);
    expect(temperaturesLivraisonOk({ camion: 2, frais: 2, surgele: -19 })).toBe(true);
  });
});

describe("heure de Paris", () => {
  it("service midi / soir à 16 h heure de Paris, été comme hiver", () => {
    expect(service(Date.parse("2026-11-20T14:59:00Z"))).toBe("midi");  // 15:59 Paris (hiver)
    expect(service(Date.parse("2026-11-20T15:00:00Z"))).toBe("soir");  // 16:00 Paris
    expect(service(Date.parse("2026-07-01T13:59:00Z"))).toBe("midi");  // 15:59 Paris (été)
    expect(service(Date.parse("2026-07-01T14:00:00Z"))).toBe("soir");
  });
  it("range les photos par site et par jour de Paris", () => {
    expect(cheminPhoto("site-1", "abc", Date.parse("2026-11-20T23:30:00Z"))).toBe("site-1/2026-11-21/abc.webp");
  });
});

import { minuteurConforme, transitionPermise } from "./logique";
describe("minuteurs de cuisine", () => {
  it("refroidissement : sous +10 °C en 2 h au plus", () => {
    expect(minuteurConforme("refroidissement", 8, 110 * MIN)).toBe(true);
    expect(minuteurConforme("refroidissement", 10, 110 * MIN)).toBe(false);
    expect(minuteurConforme("refroidissement", 5, 121 * MIN)).toBe(false);
  });
  it("remise en température : +63 °C en 1 h au plus", () => {
    expect(minuteurConforme("remise_temperature", 63, 55 * MIN)).toBe(true);
    expect(minuteurConforme("remise_temperature", 60, 55 * MIN)).toBe(false);
    expect(minuteurConforme("remise_temperature", 70, 61 * MIN)).toBe(false);
  });
});
describe("cycle des anomalies", () => {
  it("tout le monde peut traiter, seuls chef / responsable / siège vérifient", () => {
    expect(transitionPermise("ouverte", "traitee", "equipe")).toBe(true);
    expect(transitionPermise("traitee", "verifiee", "equipe")).toBe(false);
    expect(transitionPermise("traitee", "verifiee", "chef")).toBe(true);
    expect(transitionPermise("ouverte", "verifiee", "siege")).toBe(false);
    expect(transitionPermise("verifiee", "ouverte", "siege")).toBe(false);
  });
});
