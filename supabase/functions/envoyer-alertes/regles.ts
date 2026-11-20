// Règles pures de l'envoi des alertes (sans Deno ni réseau) : testées par vitest depuis app/.

export type Niveau = "chef" | "responsable" | "siege";
export interface Notification { id: number; site_id: string; destinataire: Niveau; titre: string; cree_at: string }
export interface Destinataire { site_id: string | null; role: Niveau | "equipe"; nom: string; email: string; actif: boolean; resume_quotidien?: boolean }
export interface Site { id: string; nom: string; ville: string }
export interface Email { a: string[]; sujet: string; html: string; ids: number[] }

/** Ordre de repli : si personne n'est configuré à un niveau, l'alerte remonte au niveau au-dessus. Rien ne se perd. */
const REPLI: Record<Niveau, Niveau[]> = { chef: ["chef", "responsable", "siege"], responsable: ["responsable", "siege"], siege: ["siege"] };

export function destinatairesPour(n: Pick<Notification, "site_id" | "destinataire">, dests: Destinataire[]): string[] {
  for (const niveau of REPLI[n.destinataire]) {
    const emails = dests
      .filter((d) => d.actif && d.role === niveau && (niveau === "siege" ? d.site_id === null || d.site_id === n.site_id : d.site_id === n.site_id))
      .map((d) => d.email.trim().toLowerCase());
    if (emails.length) return [...new Set(emails)].sort();
  }
  return [];
}

const echapper = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

/** Une seule alerte par restaurant et par groupe de destinataires, avec toutes les notifications en attente. */
export function regrouper(notifs: Notification[], dests: Destinataire[], sites: Site[], lienApp: string): { emails: Email[]; sansDestinataire: number[] } {
  const groupes = new Map<string, { a: string[]; site: string; liste: Notification[] }>();
  const sansDestinataire: number[] = [];
  for (const n of notifs) {
    const a = destinatairesPour(n, dests);
    if (!a.length) { sansDestinataire.push(n.id); continue; }
    const cle = `${n.site_id}|${a.join(",")}`;
    const g = groupes.get(cle) ?? { a, site: n.site_id, liste: [] };
    g.liste.push(n);
    groupes.set(cle, g);
  }
  const emails = [...groupes.values()].map((g) => {
    const s = sites.find((x) => x.id === g.site);
    const nomSite = s ? `${s.nom} · ${s.ville}` : "Restaurant";
    const critique = g.liste.some((n) => n.titre.startsWith("Critique"));
    const lignes = g.liste.map((n) => `<li><b>${heure(n.cree_at)}</b> · ${echapper(n.titre)}</li>`).join("");
    return {
      a: g.a,
      ids: g.liste.map((n) => n.id),
      sujet: `${critique ? "⚠️ CRITIQUE · " : ""}${nomSite} · ${g.liste.length} alerte${g.liste.length > 1 ? "s" : ""} hygiène`,
      html: `<p>Bonjour,</p><p>Alertes du restaurant <b>${echapper(nomSite)}</b> :</p><ul>${lignes}</ul>`
        + `<p><a href="${lienApp}">Ouvrir l'app Suivi Hygiène</a></p><p style="color:#5a6a77;font-size:13px">Message automatique, ne pas répondre.</p>`,
    };
  });
  return { emails, sansDestinataire };
}

export interface ResumeSite {
  site_id: string; nom: string; ville: string; taches_total: number; taches_faites: number; taches_a_lheure: number;
  non_faites: string[]; anomalies_ouvertes: number; critiques: string[]; livraisons: number; livraisons_nc: number;
}

function blocResume(r: ResumeSite): string {
  const etat = r.non_faites.length || r.critiques.length ? "⚠️" : "✅";
  return `<h3 style="margin:16px 0 4px">${etat} ${echapper(r.nom)} · ${echapper(r.ville)}</h3><ul>`
    + `<li>Tâches : ${r.taches_faites}/${r.taches_total} faites, dont ${r.taches_a_lheure} à l'heure</li>`
    + (r.non_faites.length ? `<li><b>Non faites :</b> ${r.non_faites.map(echapper).join(", ")}</li>` : "")
    + `<li>Anomalies ouvertes : ${r.anomalies_ouvertes}${r.critiques.length ? ` · <b>critiques :</b> ${r.critiques.map(echapper).join(", ")}` : ""}</li>`
    + `<li>Livraisons : ${r.livraisons}${r.livraisons_nc ? ` (dont ${r.livraisons_nc} non conforme${r.livraisons_nc > 1 ? "s" : ""})` : ""}</li></ul>`;
}

/** Résumé du soir : un e-mail par restaurant à ses chefs/responsables, et un e-mail groupé au siège. */
export function emailsResume(resumes: ResumeSite[], dests: Destinataire[], lienApp: string, jour: string): Email[] {
  const actifs = dests.filter((d) => d.actif && d.resume_quotidien !== false);
  const out: Email[] = [];
  for (const r of resumes) {
    const a = [...new Set(actifs.filter((d) => d.site_id === r.site_id && (d.role === "chef" || d.role === "responsable")).map((d) => d.email.trim().toLowerCase()))].sort();
    if (a.length) out.push({ a, ids: [], sujet: `Résumé hygiène du ${jour} · ${r.nom}`, html: blocResume(r) + `<p><a href="${lienApp}">Ouvrir l'app</a></p>` });
  }
  const siege = [...new Set(actifs.filter((d) => d.role === "siege" && d.site_id === null).map((d) => d.email.trim().toLowerCase()))].sort();
  if (siege.length && resumes.length) {
    const tri = resumes.slice().sort((x, y) => (y.non_faites.length + y.critiques.length * 3) - (x.non_faites.length + x.critiques.length * 3));
    out.push({ a: siege, ids: [], sujet: `Résumé hygiène du groupe · ${jour}`, html: `<p>Restaurants du plus préoccupant au meilleur :</p>${tri.map(blocResume).join("")}<p><a href="${lienApp}">Ouvrir le tableau de bord</a></p>` });
  }
  return out;
}
