import { describe, expect, it } from "vitest";
import { destinatairesPour, emailsResume, regrouper, type Destinataire } from "../../supabase/functions/envoyer-alertes/regles";

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
