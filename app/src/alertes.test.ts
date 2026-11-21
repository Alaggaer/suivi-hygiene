import { describe, expect, it } from "vitest";
import { alerteSauvegarde, destinatairesPour, emailsResume, regrouper, type Destinataire } from "../../supabase/functions/envoyer-alertes/regles";

const S1 = "site-1", S2 = "site-2";
const sites = [{ id: S1, nom: "DALLAS", ville: "CHAMBRAY" }, { id: S2, nom: "BOSTON", ville: "RENNES" }];
const d = (site_id: string | null, role: Destinataire["role"], email: string, actif = true): Destinataire => ({ site_id, role, nom: email, email, actif });

describe("à qui envoyer une alerte", () => {
  const dests = [d(S1, "chef", "chef.dallas@x.fr"), d(S1, "responsable", "resp.dallas@x.fr"), d(null, "siege", "siege@x.fr"), d(S2, "chef", "chef.boston@x.fr", false)];
  it("au bon niveau et au bon restaurant", () => {
    expect(destinatairesPour({ site_id: S1, destinataire: "chef" }, dests)).toEqual(["chef.dallas@x.fr"]);
    expect(destinatairesPour({ site_id: S1, destinataire: "responsable" }, dests)).toEqual(["resp.dallas@x.fr"]);
    expect(destinatairesPour({ site_id: S1, destinataire: "siege" }, dests)).toEqual(["siege@x.fr"]);
  });
  it("remonte au niveau au-dessus si personne n'est configuré (ou désactivé)", () => {
    expect(destinatairesPour({ site_id: S2, destinataire: "chef" }, dests)).toEqual(["siege@x.fr"]);
  });
  it("ne prévient jamais le chef d'un autre restaurant", () => {
    expect(destinatairesPour({ site_id: S2, destinataire: "chef" }, dests)).not.toContain("chef.dallas@x.fr");
  });
});

describe("regroupement des alertes", () => {
  it("un e-mail par restaurant et par destinataires ; signale les alertes sans destinataire", () => {
    const n = (id: number, site_id: string, destinataire: "chef" | "siege", titre: string) => ({ id, site_id, destinataire, titre, cree_at: "2026-11-20T10:30:00Z" });
    const { emails, sansDestinataire } = regrouper(
      [n(1, S1, "chef", "En retard : Relevé"), n(2, S1, "chef", "En retard : Huile"), n(3, S1, "siege", "Critique : Souris <réserve>"), n(4, S2, "chef", "En retard : Relevé")],
      [d(S1, "chef", "chef@x.fr"), d(null, "siege", "siege@x.fr")], sites, "https://app",
    );
    expect(emails).toHaveLength(3);
    const chef = emails.find((e) => e.a[0] === "chef@x.fr")!;
    expect(chef.ids).toEqual([1, 2]);
    expect(chef.sujet).toBe("DALLAS · CHAMBRAY · 2 alertes hygiène");
    const critique = emails.find((e) => e.ids.includes(3))!;
    expect(critique.sujet.startsWith("⚠️ CRITIQUE")).toBe(true);
    expect(critique.html).toContain("&lt;réserve&gt;");          // texte saisi en cuisine : jamais interprété comme du HTML
    expect(emails.find((e) => e.ids.includes(4))!.a).toEqual(["siege@x.fr"]);  // BOSTON sans chef → siège
    expect(sansDestinataire).toEqual([]);
  });
  it("sans aucun destinataire, rien n'est envoyé mais l'alerte est signalée", () => {
    const r = regrouper([{ id: 9, site_id: S1, destinataire: "chef", titre: "x", cree_at: "2026-11-20T10:30:00Z" }], [], sites, "https://app");
    expect(r.emails).toEqual([]);
    expect(r.sansDestinataire).toEqual([9]);
  });
});

describe("résumé du soir", () => {
  const r = (site_id: string, nom: string, non_faites: string[], critiques: string[] = []) => ({
    site_id, nom, ville: "X", taches_total: 4, taches_faites: 4 - non_faites.length, taches_a_lheure: 2, non_faites, anomalies_ouvertes: critiques.length, critiques, livraisons: 2, livraisons_nc: 0,
  });
  it("un e-mail par restaurant à ses responsables, et un e-mail groupé au siège trié du pire au meilleur", () => {
    const emails = emailsResume([r(S1, "DALLAS", []), r(S2, "BOSTON", ["Relevé du soir"], ["Souris"])],
      [d(S1, "responsable", "resp@x.fr"), d(null, "siege", "siege@x.fr")], "https://app", "20/11/2026");
    expect(emails.map((e) => e.a[0])).toEqual(["resp@x.fr", "siege@x.fr"]);
    const siege = emails[1].html;
    expect(siege.indexOf("BOSTON")).toBeLessThan(siege.indexOf("DALLAS"));
    expect(siege).toContain("Relevé du soir");
  });
});

describe("alerte sauvegarde en retard", () => {
  const M = new Date("2026-11-21T12:00:00Z");
  const h = (n: number) => new Date(M.getTime() - n * 3600_000).toISOString();
  const siege = [{ site_id: null, role: "siege" as const, nom: "S", email: "s@x.fr", actif: true },
    { site_id: null, role: "siege" as const, nom: "S2", email: "s@x.fr", actif: true },
    { site_id: "a", role: "chef" as const, nom: "C", email: "c@x.fr", actif: true }];
  it("rien tant que la dernière sauvegarde a moins de 26 h", () => {
    expect(alerteSauvegarde(h(25), null, siege, "https://x", M)).toBeNull();
  });
  it("alerte le siège seulement (sans doublon) au-delà de 26 h ou sans aucune sauvegarde", () => {
    const e = alerteSauvegarde(h(30), null, siege, "https://x", M)!;
    expect(e.a).toEqual(["s@x.fr"]);
    expect(e.sujet).toContain("Sauvegarde");
    expect(e.html).toContain("30 h");
    expect(alerteSauvegarde(null, null, siege, "https://x", M)!.html).toContain("depuis le début du suivi");
  });
  it("pas plus d'une alerte par 24 h", () => {
    expect(alerteSauvegarde(h(40), h(10), siege, "https://x", M)).toBeNull();
    expect(alerteSauvegarde(h(60), h(25), siege, "https://x", M)).not.toBeNull();
  });
  it("personne au siège : pas d'e-mail", () => {
    expect(alerteSauvegarde(h(40), null, siege.filter((d) => d.role !== "siege"), "https://x", M)).toBeNull();
  });
});
