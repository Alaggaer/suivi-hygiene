// Comptes des tablettes (un par restaurant), gérés par le siège depuis l'app.
// Seul un compte siège peut appeler cette fonction ; elle utilise la clé de service, jamais exposée à l'app.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const rep = (corps: unknown, status = 200) => Response.json(corps, { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const jeton = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: qui } = await admin.auth.getUser(jeton);
  if (qui?.user?.app_metadata?.role !== "siege") return rep({ erreur: "Réservé au siège" }, 403);

  const c = await req.json().catch(() => ({})) as { action?: string; site_id?: string; email?: string; password?: string; user_id?: string };
  if (c.password !== undefined && c.password.length < 10) return rep({ erreur: "Mot de passe trop court : 10 caractères au moins" }, 400);

  if (c.action === "lister") {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) return rep({ erreur: error.message }, 500);
    return rep(data.users
      .filter((u) => u.app_metadata?.role === "tablette" && (!c.site_id || u.app_metadata?.site_id === c.site_id))
      .map((u) => ({ id: u.id, email: u.email, site_id: u.app_metadata?.site_id, cree_at: u.created_at, derniere_connexion: u.last_sign_in_at })));
  }
  if (c.action === "creer") {
    if (!c.site_id || !c.email || !c.password) return rep({ erreur: "Restaurant, e-mail et mot de passe obligatoires" }, 400);
    const { data: site } = await admin.from("sites").select("id").eq("id", c.site_id).maybeSingle();
    if (!site) return rep({ erreur: "Restaurant inconnu" }, 400);
    const { data, error } = await admin.auth.admin.createUser({
      email: c.email.trim().toLowerCase(), password: c.password, email_confirm: true,
      app_metadata: { site_id: c.site_id, role: "tablette" },
    });
    if (error) return rep({ erreur: error.message.includes("already") ? "Cet e-mail est déjà utilisé" : error.message }, 400);
    return rep({ id: data.user.id, email: data.user.email });
  }
  if (c.action === "mot_de_passe") {
    if (!c.user_id || !c.password) return rep({ erreur: "Compte et mot de passe obligatoires" }, 400);
    const { data: u } = await admin.auth.admin.getUserById(c.user_id);
    if (u?.user?.app_metadata?.role !== "tablette") return rep({ erreur: "Ce n'est pas un compte tablette" }, 400);
    const { error } = await admin.auth.admin.updateUserById(c.user_id, { password: c.password });
    if (error) return rep({ erreur: error.message }, 400);
    return rep({ ok: true });
  }
  return rep({ erreur: "Action inconnue" }, 400);
});
