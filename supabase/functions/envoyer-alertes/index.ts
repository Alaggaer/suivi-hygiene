// Fonction d'envoi des alertes et du résumé du soir, par e-mail (Resend).
// Appelée par la planification de la base : ?mode=alertes toutes les 5 min, ?mode=resume chaque soir.
// Secrets : RESEND_API_KEY, EXPEDITEUR (ex. "Suivi Hygiène <alertes@mondomaine.fr>"), LIEN_APP.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { alerteSauvegarde, emailsResume, regrouper, type Email } from "./regles.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CLE = Deno.env.get("RESEND_API_KEY");
const EXPEDITEUR = Deno.env.get("EXPEDITEUR") ?? "Suivi Hygiène <onboarding@resend.dev>";
const LIEN = Deno.env.get("LIEN_APP") ?? "https://alaggaer.github.io/suivi-hygiene/";

async function envoyer(e: Email): Promise<string | null> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${CLE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EXPEDITEUR, to: e.a, subject: e.sujet, html: e.html }),
  });
  return r.ok ? null : `${r.status} ${(await r.text()).slice(0, 300)}`;
}

Deno.serve(async (req) => {
  // Seule la planification de la base peut déclencher un envoi : elle joint la clé du coffre, que la base vérifie.
  const { data: autorise } = await sb.rpc("verifier_cle_alertes", { p_cle: req.headers.get("x-cle-alertes") });
  if (autorise !== true) return Response.json({ erreur: "Appel non autorisé" }, { status: 401 });
  const mode = new URL(req.url).searchParams.get("mode") ?? "alertes";
  if (!CLE) return Response.json({ envoyes: 0, raison: "RESEND_API_KEY non configurée : rien n'est envoyé, les alertes restent en attente." });

  const [{ data: dests, error: e1 }, { data: sites, error: e2 }] = await Promise.all([
    sb.from("destinataires").select("site_id, role, nom, email, actif, resume_quotidien").eq("actif", true),
    sb.from("sites").select("id, nom, ville"),
  ]);
  if (e1 || e2) return Response.json({ erreur: (e1 ?? e2)!.message }, { status: 500 });

  if (mode === "sauvegarde") {
    // Alerte si aucune sauvegarde réussie depuis plus de 26 h (au plus une fois par 24 h).
    const [{ data: der }, { data: reg }] = await Promise.all([
      sb.from("sauvegardes").select("at").order("at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("reglages").select("valeur").eq("cle", "sauvegarde_alerte").maybeSingle(),
    ]);
    const email = alerteSauvegarde(der?.at ?? null, (reg?.valeur as { at?: string } | null)?.at ?? null, dests ?? [],
      "https://github.com/Alaggaer/suivi-hygiene-sauvegardes/actions");
    if (!email) return Response.json({ envoyes: 0, derniere: der?.at ?? null });
    const err = await envoyer(email);
    if (!err) await sb.from("reglages").upsert({ cle: "sauvegarde_alerte", valeur: { at: new Date().toISOString() } });
    return Response.json({ envoyes: err ? 0 : 1, erreur: err, derniere: der?.at ?? null });
  }

  if (mode === "resume") {
    // Au plus un résumé par jour.
    const jourIso = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    const { data: dejaFait } = await sb.from("reglages").select("valeur").eq("cle", "resume_envoye").maybeSingle();
    if ((dejaFait?.valeur as { jour?: string } | null)?.jour === jourIso) return Response.json({ envoyes: 0, raison: "Résumé déjà envoyé aujourd'hui" });
    await sb.from("reglages").upsert({ cle: "resume_envoye", valeur: { jour: jourIso } });
    const { data: resumes, error } = await sb.rpc("resume_jour");
    if (error) return Response.json({ erreur: error.message }, { status: 500 });
    const jour = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
    const emails = emailsResume(resumes ?? [], dests ?? [], LIEN, jour);
    const erreurs = (await Promise.all(emails.map(envoyer))).filter(Boolean);
    return Response.json({ envoyes: emails.length - erreurs.length, erreurs });
  }

  const { data: notifs, error } = await sb.from("notifications")
    .select("id, site_id, destinataire, titre, cree_at, tentatives")
    .is("envoyee_at", null).lt("tentatives", 5).order("cree_at").limit(200);
  if (error) return Response.json({ erreur: error.message }, { status: 500 });

  const { emails, sansDestinataire } = regrouper(notifs ?? [], dests ?? [], sites ?? [], LIEN);
  let envoyes = 0;
  for (const e of emails) {
    const err = await envoyer(e);
    if (!err) {
      await sb.from("notifications").update({ envoyee_at: new Date().toISOString(), erreur: null }).in("id", e.ids);
      envoyes++;
    } else {
      for (const n of (notifs ?? []).filter((x) => e.ids.includes(x.id))) {
        await sb.from("notifications").update({ tentatives: n.tentatives + 1, erreur: err }).eq("id", n.id);
      }
    }
  }
  // Personne à prévenir : on le note (visible par le siège) sans réessayer indéfiniment.
  if (sansDestinataire.length) {
    await sb.from("notifications").update({ erreur: "Aucun destinataire configuré" }).in("id", sansDestinataire);
  }
  return Response.json({ envoyes, sansDestinataire: sansDestinataire.length });
});
