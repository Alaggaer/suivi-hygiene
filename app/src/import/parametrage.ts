/**
 * Import du tableau « Paramétrage des restaurants » (Excel), en deux temps :
 * 1. lireClasseur : les onglets deviennent des données propres, avec la liste des lignes refusées et pourquoi ;
 * 2. planifier : comparaison avec ce qui existe déjà → la liste des créations et modifications, sans doublon.
 * Rien n'est jamais supprimé : ce qui manque dans le tableau reste tel quel (et est signalé).
 * Fonctions pures (sans réseau), testées par vitest.
 */
import type { EnceinteGestion, Employe, FournisseurGestion, FriteuseGestion, ProduitLivre, RoleEmploye, SiteGestion } from "../types";

export type Cellule = string | number | boolean | Date | null | undefined;
export type Classeur = { sheet: string; data: Cellule[][] }[];

export interface Probleme { onglet: string; ligne: number; message: string; bloquant: boolean }
export interface RestoTableau { nom: string; ville: string; ouverture: string | null; soir: string | null; responsable: string | null }
export interface EnceinteTableau { restaurant: string; nom: string; t_max: number; ordre: number }
export interface FriteuseTableau { restaurant: string; nom: string; litres: number }
export interface EmployeTableau { restaurant: string; nom: string; role: RoleEmploye }
export interface FournisseurTableau { nom: string; produits: ProduitLivre[] | null; viande: boolean | null; jours: number[] | null }
export interface Modele {
  restaurants: RestoTableau[]; enceintes: EnceinteTableau[]; friteuses: FriteuseTableau[];
  employes: EmployeTableau[]; fournisseurs: FournisseurTableau[]; problemes: Probleme[];
}

/** Clé de comparaison : majuscules, sans accents ni espaces superflus. */
export const cle = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘`´]/g, "'").toUpperCase().replace(/\s+/g, " ").trim();
/** Clé de comparaison : en plus, tirets, apostrophes et points comptent comme des espaces (« Jean-Pierre » = « Jean Pierre », « L'Atelier » = « L Atelier »). */
export const cmp = (s: string) => cle(s).replace(/[-‐–—'._]/g, " ").replace(/\s+/g, " ").trim();
export const meme = (a: string, b: string) => cmp(a) === cmp(b);
const texte = (c: Cellule): string => (c === null || c === undefined ? "" : c instanceof Date ? "" : String(c)).trim();

/** « 09H », « 9h30 », « 18:45 », 0.375 (heure Excel) ou une heure Excel lue comme date → « 09:00 ». null si illisible. */
export function heure(c: Cellule): string | null {
  const f = (h: number, m: number) => (h >= 0 && h < 24 && m >= 0 && m < 60 ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : null);
  if (c instanceof Date) return f(c.getUTCHours(), c.getUTCMinutes());
  if (typeof c === "number") return c >= 0 && c < 1 ? f(Math.floor(c * 24 + 1e-9), Math.round((c * 24 - Math.floor(c * 24 + 1e-9)) * 60)) : null;
  const m = texte(c).toLowerCase().match(/^(\d{1,2})\s*(?:h|:)\s*(\d{2})?$/) ?? texte(c).match(/^(\d{1,2})$/);
  return m ? f(Number(m[1]), Number(m[2] ?? 0)) : null;
}

/** « -18 », « 3,5 », « +4 °C » → nombre. */
export function nombre(c: Cellule): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const m = texte(c).replace(",", ".").replace(/\s|°c?|l$/gi, "").match(/^[+-]?\d+(\.\d+)?$/);
  return m ? Number(m[0]) : null;
}

export function oui(c: Cellule): boolean | null {
  if (typeof c === "boolean") return c;
  const t = cle(texte(c));
  return t === "OUI" || t === "O" || t === "X" ? true : t === "NON" || t === "N" ? false : null;
}

const ROLES: Record<string, RoleEmploye> = { EQUIPE: "equipe", EQUIPIER: "equipe", CHEF: "chef", "RESPONSABLE DE SITE": "responsable", RESPONSABLE: "responsable" };
const PRODUITS: Record<string, ProduitLivre> = { FRAIS: "frais", SEC: "sec", SURGELE: "surgele", SURGELES: "surgele", SURGELÉ: "surgele" };
const JOURS = ["LU", "MA", "ME", "JE", "VE", "SA", "DI"];

/** « Frais, Surgelé » → ["frais", "surgele"] ; null si vide ; undefined si un mot est inconnu. */
export function produits(c: Cellule): ProduitLivre[] | null | undefined {
  const mots = texte(c).split(/[,;/+]|\bet\b/i).map((x) => cle(x)).filter(Boolean);
  if (!mots.length) return null;
  const l = mots.map((m) => PRODUITS[m]);
  return l.some((x) => !x) ? undefined : [...new Set(l)];
}

/** « lundi, jeudi », « lun mer ven », « mardi-samedi » → [1, 4] ; null si vide ; undefined si illisible. */
export function jours(c: Cellule): number[] | null | undefined {
  const t = cle(texte(c));
  if (!t) return null;
  if (/^(TOUS LES JOURS|7\/7|TLJ)$/.test(t)) return [1, 2, 3, 4, 5, 6, 7];
  const plage = t.match(/^([A-Z]+)\s*(?:-|A|AU)\s*([A-Z]+)$/);
  const num = (m: string) => { const i = JOURS.indexOf(m.slice(0, 2)); return i < 0 || m.length < 2 ? 0 : i + 1; };
  if (plage && num(plage[1]) && num(plage[2]) && num(plage[1]) < num(plage[2])) {
    return Array.from({ length: num(plage[2]) - num(plage[1]) + 1 }, (_, k) => num(plage[1]) + k);
  }
  const l = t.split(/[\s,;/]+|\bET\b/).filter(Boolean).map(num);
  return l.some((x) => !x) ? undefined : [...new Set(l)].sort((a, b) => a - b);
}

const NEGATIF = /NEGATIF|NEGATIVE|CONGEL|SURGEL/;

/** Lit les onglets utiles du classeur. Les en-têtes sont repérés par leur nom (l'ordre des colonnes peut changer). */
export function lireClasseur(classeur: Classeur): Modele {
  const problemes: Probleme[] = [];
  const pb = (onglet: string, ligne: number, message: string, bloquant = true) => problemes.push({ onglet, ligne, message, bloquant });
  const onglet = (nom: string) => classeur.find((s) => cle(s.sheet) === cle(nom))?.data ?? null;

  /** Lignes d'un onglet en objets, d'après les en-têtes de la 1re ligne ; n = numéro de ligne Excel. */
  function lignes(nom: string, colonnes: Record<string, string[]>) {
    const d = onglet(nom);
    if (!d) { pb(nom, 0, "Onglet introuvable", false); return []; }
    const entete = (d[0] ?? []).map((c) => cle(texte(c)));
    const idx: Record<string, number> = {};
    for (const [k, noms] of Object.entries(colonnes)) {
      idx[k] = entete.findIndex((h) => noms.some((n) => h.startsWith(cle(n))));
      if (idx[k] < 0) pb(nom, 1, `Colonne « ${noms[0]} » introuvable`);
    }
    return d.slice(1).map((r, i) => {
      const o: Record<string, Cellule> = {};
      for (const k of Object.keys(colonnes)) o[k] = idx[k] >= 0 ? r[idx[k]] : null;
      return { n: i + 2, o, vide: r.every((c) => texte(c) === "" && typeof c !== "number" && !(c instanceof Date)) };
    }).filter((x) => !x.vide);
  }

  const restaurants: RestoTableau[] = [];
  for (const { n, o } of lignes("Restaurants", { nom: ["Restaurant"], ville: ["Ville"], resp: ["Responsable"], ouv: ["Ouverture"], soir: ["Début service soir", "Debut service soir"] })) {
    const nom = cle(texte(o.nom)), ville = texte(o.ville).toUpperCase().replace(/\s+/g, " ");
    if (nom.length < 2) { pb("Restaurants", n, "Nom du restaurant manquant"); continue; }
    if (restaurants.some((r) => meme(r.nom, nom))) { pb("Restaurants", n, `${nom} apparaît deux fois`); continue; }
    const ouverture = heure(o.ouv), soir = heure(o.soir);
    if (texte(o.ouv) && !ouverture && !(o.ouv instanceof Date) && typeof o.ouv !== "number") pb("Restaurants", n, `Heure d'ouverture illisible : « ${texte(o.ouv)} » (ex. 09h00)`, false);
    if (texte(o.soir) && !soir && !(o.soir instanceof Date) && typeof o.soir !== "number") pb("Restaurants", n, `Heure du service du soir illisible : « ${texte(o.soir)} »`, false);
    restaurants.push({ nom, ville, ouverture, soir, responsable: texte(o.resp) || null });
  }
  const connu = (onglet: string, n: number, r: Cellule) => {
    const nom = cle(texte(r));
    if (!nom) { pb(onglet, n, "Restaurant manquant"); return null; }
    const resto = restaurants.find((x) => meme(x.nom, nom));
    if (!resto) { pb(onglet, n, `Restaurant « ${nom} » absent de l'onglet Restaurants`); return null; }
    return resto.nom;
  };

  const enceintes: EnceinteTableau[] = [];
  for (const { n, o } of lignes("Enceintes", { resto: ["Restaurant"], nom: ["Enceinte"], type: ["Type"], tmax: ["T° max", "T max", "Temperature max"] })) {
    const r = connu("Enceintes", n, o.resto); if (!r) continue;
    const nom = texte(o.nom), t = nombre(o.tmax), neg = NEGATIF.test(cle(texte(o.type)) + " " + cle(nom));
    if (nom.length < 2) { pb("Enceintes", n, "Nom de l'enceinte manquant"); continue; }
    if (t === null) { pb("Enceintes", n, `${r} · ${nom} : température maximale manquante`); continue; }
    if (neg ? t < -30 || t > -12 : t < 0 || t > 10) {
      pb("Enceintes", n, `${r} · ${nom} : ${t} °C impossible pour ${neg ? "du froid négatif (entre −30 et −12)" : "du froid positif (entre 0 et +10)"}`); continue;
    }
    if (enceintes.some((e) => e.restaurant === r && meme(e.nom, nom))) { pb("Enceintes", n, `${r} · ${nom} apparaît deux fois`); continue; }
    enceintes.push({ restaurant: r, nom, t_max: t, ordre: enceintes.filter((e) => e.restaurant === r).length + 1 });
  }

  const friteuses: FriteuseTableau[] = [];
  for (const { n, o } of lignes("Friteuses", { resto: ["Restaurant"], nom: ["Friteuse"], litres: ["Capacité", "Capacite"] })) {
    const r = connu("Friteuses", n, o.resto); if (!r) continue;
    const nom = texte(o.nom), l = nombre(o.litres);
    if (nom.length < 2) { pb("Friteuses", n, "Nom de la friteuse manquant"); continue; }
    if (l === null) { pb("Friteuses", n, `${r} · ${nom} : capacité manquante, ligne ignorée`, false); continue; }
    if (l <= 0 || l > 99) { pb("Friteuses", n, `${r} · ${nom} : capacité de ${l} L impossible`); continue; }
    if (friteuses.some((f) => f.restaurant === r && meme(f.nom, nom))) { pb("Friteuses", n, `${r} · ${nom} apparaît deux fois`); continue; }
    friteuses.push({ restaurant: r, nom, litres: l });
  }

  const employes: EmployeTableau[] = [];
  for (const { n, o } of lignes("Employés", { resto: ["Restaurant"], prenom: ["Prénom", "Prenom"], nom: ["Nom"], role: ["Rôle", "Role"] })) {
    const r = connu("Employés", n, o.resto); if (!r) continue;
    const nom = [texte(o.prenom), texte(o.nom)].filter(Boolean).join(" ");
    const role = ROLES[cle(texte(o.role))];
    if (nom.length < 2) { pb("Employés", n, "Prénom manquant"); continue; }
    if (!role) { pb("Employés", n, `${r} · ${nom} : rôle « ${texte(o.role)} » inconnu (Équipe, Chef ou Responsable de site)`); continue; }
    if (employes.some((e) => e.restaurant === r && meme(e.nom, nom))) { pb("Employés", n, `${r} · ${nom} apparaît deux fois`); continue; }
    employes.push({ restaurant: r, nom, role });
  }
  // Le responsable indiqué dans l'onglet Restaurants, s'il n'a pas sa ligne dans l'onglet Employés.
  for (const r of restaurants) {
    if (r.responsable && !employes.some((e) => e.restaurant === r.nom && (e.role === "responsable" || meme(e.nom, r.responsable!) || cmp(e.nom).startsWith(cmp(r.responsable!) + " ")))) {
      employes.push({ restaurant: r.nom, nom: r.responsable, role: "responsable" });
    }
  }

  const fournisseurs: FournisseurTableau[] = [];
  for (const { n, o } of lignes("Fournisseurs", { nom: ["Fournisseur"], produits: ["Produits"], viande: ["Livre de la viande", "Viande"], jours: ["Jours"] })) {
    const nom = cle(texte(o.nom));
    if (nom.length < 2) { pb("Fournisseurs", n, "Nom du fournisseur manquant"); continue; }
    if (fournisseurs.some((f) => meme(f.nom, nom))) { pb("Fournisseurs", n, `${nom} apparaît deux fois`); continue; }
    const p = produits(o.produits), j = jours(o.jours);
    if (p === undefined) pb("Fournisseurs", n, `${nom} : produits « ${texte(o.produits)} » non reconnus (Frais, Sec, Surgelé), laissés tels quels`, false);
    if (j === undefined) pb("Fournisseurs", n, `${nom} : jours « ${texte(o.jours)} » non reconnus (ex. lundi, jeudi), laissés tels quels`, false);
    fournisseurs.push({ nom, produits: p ?? null, viande: oui(o.viande), jours: j ?? null });
  }
  return { restaurants, enceintes, friteuses, employes, fournisseurs, problemes };
}

/* ---------- Comparaison avec l'existant ---------- */

export interface Existant {
  sites: SiteGestion[];
  enceintes: Record<string, EnceinteGestion[]>;   // par id de restaurant
  friteuses: Record<string, FriteuseGestion[]>;
  employes: Record<string, Employe[]>;
  fournisseurs: FournisseurGestion[];
}
export type Action =
  | { t: "site_creer"; libelle: string; nom: string; ville: string; ouverture: string; soir: string }
  | { t: "site_maj"; libelle: string; ligne: SiteGestion }
  | { t: "enceinte"; libelle: string; restaurant: string; ligne: Omit<EnceinteGestion, "site_id"> }
  | { t: "friteuse"; libelle: string; restaurant: string; ligne: Omit<FriteuseGestion, "site_id"> }
  | { t: "employe"; libelle: string; restaurant: string; nom: string; role: RoleEmploye }
  | { t: "fournisseur"; libelle: string; ligne: FournisseurGestion };
export interface Plan { actions: Action[]; inchanges: number; nonRepris: string[] }

const memes = (a: unknown[] | null, b: unknown[] | null) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
const hhmm = (t: string) => t.slice(0, 5);

export function planifier(m: Modele, ex: Existant): Plan {
  const actions: Action[] = [], nonRepris: string[] = [];
  let inchanges = 0;
  const siteDe = (nom: string) => ex.sites.find((s) => meme(s.nom, nom));

  for (const r of m.restaurants) {
    const s = siteDe(r.nom);
    if (!s) {
      actions.push({ t: "site_creer", libelle: `Nouveau restaurant ${r.nom} (${r.ville || "ville à compléter"})`, nom: r.nom, ville: r.ville || "À COMPLÉTER", ouverture: r.ouverture ?? "09:00", soir: r.soir ?? "18:45" });
      continue;
    }
    const n = { ...s, ville: r.ville && cle(r.ville) !== cle(s.ville) ? r.ville : s.ville, ouverture: r.ouverture ?? hhmm(s.ouverture), service_soir: r.soir ?? hhmm(s.service_soir) };
    const diff = [n.ville !== s.ville && `ville ${n.ville}`, n.ouverture !== hhmm(s.ouverture) && `ouverture ${n.ouverture}`,
      n.service_soir !== hhmm(s.service_soir) && `service du soir ${n.service_soir}`].filter(Boolean);
    if (diff.length) actions.push({ t: "site_maj", libelle: `${r.nom} : ${diff.join(", ")}`, ligne: n }); else inchanges++;
  }

  for (const r of m.restaurants) {
    const s = siteDe(r.nom);
    const exE = s ? ex.enceintes[s.id] ?? [] : [], exF = s ? ex.friteuses[s.id] ?? [] : [], exP = s ? ex.employes[s.id] ?? [] : [];
    for (const e of m.enceintes.filter((x) => x.restaurant === r.nom)) {
      const v = exE.find((x) => meme(x.nom, e.nom));
      if (!v) actions.push({ t: "enceinte", libelle: `${r.nom} · nouvelle enceinte ${e.nom} (max ${e.t_max} °C)`, restaurant: r.nom, ligne: { nom: e.nom, t_max: e.t_max, ordre: e.ordre, actif: true } });
      else if (v.t_max !== e.t_max || v.ordre !== e.ordre || !v.actif) {
        actions.push({ t: "enceinte", libelle: `${r.nom} · ${e.nom} : ${[v.t_max !== e.t_max && `max ${v.t_max} → ${e.t_max} °C`, !v.actif && "réactivée", v.ordre !== e.ordre && "ordre"].filter(Boolean).join(", ")}`,
          restaurant: r.nom, ligne: { id: v.id, nom: v.nom, t_max: e.t_max, ordre: e.ordre, actif: true } });
      } else inchanges++;
    }
    for (const v of exE.filter((x) => x.actif && !m.enceintes.some((e) => e.restaurant === r.nom && meme(e.nom, x.nom)))) nonRepris.push(`${r.nom} · enceinte ${v.nom}`);
    for (const f of m.friteuses.filter((x) => x.restaurant === r.nom)) {
      const v = exF.find((x) => meme(x.nom, f.nom));
      if (!v) actions.push({ t: "friteuse", libelle: `${r.nom} · nouvelle friteuse ${f.nom} (${f.litres} L)`, restaurant: r.nom, ligne: { nom: f.nom, litres: f.litres, actif: true } });
      else if (v.litres !== f.litres || !v.actif) actions.push({ t: "friteuse", libelle: `${r.nom} · ${f.nom} : ${v.litres} → ${f.litres} L${v.actif ? "" : ", réactivée"}`, restaurant: r.nom, ligne: { id: v.id, nom: v.nom, litres: f.litres, actif: true } });
      else inchanges++;
    }
    for (const v of exF.filter((x) => x.actif && !m.friteuses.some((f) => f.restaurant === r.nom && meme(f.nom, x.nom)))) nonRepris.push(`${r.nom} · ${v.nom}`);
    const duTableau = m.employes.filter((x) => x.restaurant === r.nom);
    for (const p of duTableau) {
      // Même personne : même nom complet ; ou prénom seul déjà enregistré, s'il ne peut désigner qu'elle
      // (« Marie » n'absorbe pas « Marie Curie » si « Marie Dupont » ou une autre « Marie » existe aussi).
      const prefixe = (court: string, long: string) => cmp(long).startsWith(cmp(court) + " ");
      const v = exP.find((x) => meme(x.nom, p.nom))
        ?? exP.find((x) => prefixe(x.nom, p.nom)
          && !duTableau.some((q) => q !== p && (meme(q.nom, x.nom) || prefixe(x.nom, q.nom)))
          && exP.filter((y) => prefixe(y.nom, p.nom) || meme(y.nom, x.nom)).length === 1);
      if (!v) actions.push({ t: "employe", libelle: `${r.nom} · nouvel employé ${p.nom} (${{ equipe: "équipe", chef: "chef", responsable: "responsable" }[p.role]})`, restaurant: r.nom, nom: p.nom, role: p.role });
      else inchanges++;   // rôle et code existants conservés : à changer dans Gestion
    }
  }

  for (const f of m.fournisseurs) {
    const v = ex.fournisseurs.find((x) => meme(x.nom, f.nom));
    if (!v) {
      actions.push({ t: "fournisseur", libelle: `Nouveau fournisseur ${f.nom}`, ligne: { nom: f.nom, produits: f.produits, viande: !!f.viande, jours_livraison: f.jours, actif: true } });
      continue;
    }
    // Une case vide dans le tableau ne change rien.
    const n = { ...v, produits: f.produits ?? v.produits, viande: f.viande ?? v.viande, jours_livraison: f.jours ?? v.jours_livraison };
    const diff = [!memes(n.produits, v.produits) && `livre ${(n.produits ?? []).join(", ")}`, n.viande !== v.viande && (n.viande ? "viande : oui" : "viande : non"),
      !memes(n.jours_livraison, v.jours_livraison) && "jours de livraison"].filter(Boolean);
    if (diff.length) actions.push({ t: "fournisseur", libelle: `${f.nom} : ${diff.join(", ")}`, ligne: n }); else inchanges++;
  }
  return { actions, inchanges, nonRepris };
}
