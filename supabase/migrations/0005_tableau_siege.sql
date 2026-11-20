-- Tableau de bord du siège : indicateurs par site sur les N derniers jours (aujourd'hui inclus).

create function tableau_siege(p_jours int default 7)
returns table (
  site_id uuid, nom text, ville text,
  taches_total int, taches_a_lheure int, taches_non_faites int,
  anomalies_ouvertes int, anomalies_critiques int, plus_ancienne_h int,
  livraisons int, livraisons_nc int,
  huile_mesures int, huile_rouges int, huile_max numeric
)
language plpgsql stable security definer set search_path = public as $$
declare debut date := (now() at time zone 'Europe/Paris')::date - (p_jours - 1);
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return query
  select s.id, s.nom, s.ville,
    (select count(*)::int from taches t where t.site_id = s.id and t.jour >= debut and t.echeance <= now()),
    (select count(*)::int from taches t where t.site_id = s.id and t.jour >= debut and t.faite_at <= t.echeance),
    (select count(*)::int from taches t where t.site_id = s.id and t.jour >= debut and t.echeance <= now() and t.faite_at is null),
    (select count(*)::int from anomalies a where a.site_id = s.id and a.statut = 'ouverte'),
    (select count(*)::int from anomalies a where a.site_id = s.id and a.statut = 'ouverte' and a.gravite = 'critique'),
    (select (extract(epoch from now() - min(a.cree_at)) / 3600)::int from anomalies a where a.site_id = s.id and a.statut = 'ouverte'),
    (select count(*)::int from livraisons l where l.site_id = s.id and l.at >= debut),
    (select count(*)::int from livraisons l where l.site_id = s.id and l.at >= debut and not l.conforme),
    (select count(*)::int from huiles h where h.site_id = s.id and h.at >= debut and h.polaires is not null),
    (select count(*)::int from huiles h where h.site_id = s.id and h.at >= debut and h.polaires >= (select (valeur->>'rouge')::numeric from reglages where cle = 'huile')),
    (select max(h.polaires) from huiles h where h.site_id = s.id and h.at >= debut)
  from sites s where s.actif
  order by s.nom;
end $$;

create function fournisseurs_non_conformes(p_jours int default 30)
returns table (fournisseur text, livraisons int, non_conformes int)
language sql stable security definer set search_path = public as $$
  select f.nom, count(l.*)::int, count(l.*) filter (where not l.conforme)::int
  from fournisseurs f join livraisons l on l.fournisseur_id = f.id
  where est_siege() and l.at >= now() - make_interval(days => p_jours)
  group by f.nom
  order by 3 desc, 2 desc
$$;
