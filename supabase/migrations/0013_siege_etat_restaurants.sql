-- Siège v3 : état du jour de chaque restaurant (cartes de l'accueil) et historique 30 jours d'un restaurant.

-- Une ligne par restaurant actif : ce qui s'est passé aujourd'hui (heure de Paris), et la dernière saisie de la tablette.
create or replace function etat_restaurants()
returns table (site_id uuid, nom text, ville text,
  taches_total int, taches_faites int, taches_en_retard int, taches_echues int,
  enceintes int, enceintes_relevees int, releves_hors_seuil int,
  friteuses int, friteuses_faites int, huile_rouges int, huile_trop_vieille int, huile_max numeric,
  livraisons int, livraisons_nc int, livraisons_non_rangees int,
  anomalies_ouvertes int, anomalies_a_verifier int, anomalies_critiques int,
  derniere_saisie timestamptz, derniere_saisie_par text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_jour date := (now() at time zone 'Europe/Paris')::date;
        d timestamptz := (v_jour::timestamp at time zone 'Europe/Paris');
        rouge numeric := (select (valeur->>'rouge')::numeric from reglages where cle = 'huile');
        jmax int := coalesce((select (valeur->>'jours_max')::int from reglages where cle = 'huile'), 14);
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return query
  with act as (   -- toutes les saisies, pour « dernière saisie »
    select r.site_id, r.at, r.par from releves r where r.at >= now() - interval '7 days'
    union all select h.site_id, h.at, h.par from huiles h where h.at >= now() - interval '7 days'
    union all select l.site_id, l.at, l.par from livraisons l where l.at >= now() - interval '7 days'
    union all select u.site_id, u.at, u.par from utilisations u where u.at >= now() - interval '7 days'
    union all select t.site_id, t.faite_at, t.faite_par from taches t where t.faite_at >= now() - interval '7 days'
  ), der as (
    select distinct on (a.site_id) a.site_id, a.at, p.nom from act a left join profils p on p.id = a.par order by a.site_id, a.at desc
  )
  select s.id, s.nom, s.ville,
    (select count(*)::int from taches t where t.site_id = s.id and t.jour = v_jour),
    (select count(*)::int from taches t where t.site_id = s.id and t.jour = v_jour and t.faite_at is not null),
    (select count(*)::int from taches t where t.site_id = s.id and t.jour = v_jour and t.faite_at is null and t.echeance < now()),
    (select count(*)::int from taches t where t.site_id = s.id and t.jour = v_jour and t.echeance < now()),
    (select count(*)::int from enceintes e where e.site_id = s.id and e.actif),
    (select count(distinct r.enceinte_id)::int from releves r where r.site_id = s.id and r.at >= d),
    (select count(*)::int from releves r where r.site_id = s.id and r.at >= d and not r.conforme),
    (select count(*)::int from friteuses f where f.site_id = s.id and f.actif),
    (select count(distinct h.friteuse_id)::int from huiles h where h.site_id = s.id and h.at >= d),
    (select count(*)::int from huiles h where h.site_id = s.id and h.at >= d and h.polaires >= rouge),
    (select count(*)::int from friteuses fr where fr.site_id = s.id and fr.actif and
      (select count(distinct (h.at at time zone 'Europe/Paris')::date) from huiles h
        where h.friteuse_id = fr.id and not h.non_utilisee
          and h.at >= coalesce((select max(h2.at) from huiles h2 where h2.friteuse_id = fr.id and h2.changement), '-infinity')) > jmax),
    (select max(h.polaires) from huiles h where h.site_id = s.id and h.at >= d),
    (select count(*)::int from livraisons l where l.site_id = s.id and l.at >= d),
    (select count(*)::int from livraisons l where l.site_id = s.id and l.at >= d and not l.conforme),
    (select count(*)::int from livraisons l where l.site_id = s.id and l.at >= d and l.range_at is null),
    (select count(*)::int from anomalies a where a.site_id = s.id and a.statut = 'ouverte'),
    (select count(*)::int from anomalies a where a.site_id = s.id and a.statut = 'traitee'),
    (select count(*)::int from anomalies a where a.site_id = s.id and a.statut <> 'verifiee' and a.gravite = 'critique'),
    der.at, der.nom
  from sites s left join der on der.site_id = s.id
  where s.actif
  order by s.nom;
end $$;

-- 30 derniers jours d'un restaurant : tâches échues / faites à l'heure / jamais faites, anomalies signalées.
create or replace function historique_site(p_site uuid, p_jours int default 30)
returns table (jour date, taches_echues int, taches_a_lheure int, taches_non_faites int, anomalies int, anomalies_critiques int)
language plpgsql stable security definer set search_path = public, extensions as $$
declare fin date := (now() at time zone 'Europe/Paris')::date;
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return query
  select g.j::date,
    (select count(*)::int from taches t where t.site_id = p_site and t.jour = g.j::date and t.echeance <= now()),
    (select count(*)::int from taches t where t.site_id = p_site and t.jour = g.j::date and t.faite_at <= t.echeance),
    (select count(*)::int from taches t where t.site_id = p_site and t.jour = g.j::date and t.echeance <= now() and t.faite_at is null),
    (select count(*)::int from anomalies a where a.site_id = p_site and (a.cree_at at time zone 'Europe/Paris')::date = g.j::date),
    (select count(*)::int from anomalies a where a.site_id = p_site and a.gravite = 'critique' and (a.cree_at at time zone 'Europe/Paris')::date = g.j::date)
  from generate_series(fin - (greatest(p_jours, 1) - 1), fin, interval '1 day') g(j)
  order by 1;
end $$;

revoke execute on function etat_restaurants(), historique_site(uuid, int) from public, anon;
grant execute on function etat_restaurants(), historique_site(uuid, int) to authenticated;
