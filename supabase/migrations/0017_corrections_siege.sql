-- Rattrapage par le siège : une saisie erronée (faute de frappe, mauvaise enceinte, doublon) n'est jamais effacée ni modifiée.
-- Le siège y ajoute une correction tracée : motif obligatoire, valeur corrigée facultative (vide = saisie annulée), qui, quand.
create table corrections (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  table_ref text not null check (table_ref in ('releves', 'huiles', 'livraisons')),
  ref_id uuid not null,
  motif text not null check (length(trim(motif)) >= 5),
  valeur_corrigee numeric(4,1),
  par uuid not null references profils(id),
  at timestamptz not null default now()
);
create index on corrections (table_ref, ref_id, at desc);
alter table corrections enable row level security;
create policy lire on corrections for select using (est_siege() or site_id = mon_site());
-- Aucune écriture directe : seulement par siege_corriger().

create or replace function siege_corriger(p_table text, p_id uuid, p_motif text, p_valeur numeric default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_site uuid; v_tmax numeric; v_id uuid;
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  if p_motif is null or length(trim(p_motif)) < 5 then raise exception 'Motif obligatoire (5 caractères au moins)' using errcode = '22023'; end if;
  if p_table = 'releves' then
    select r.site_id, e.t_max into v_site, v_tmax from releves r join enceintes e on e.id = r.enceinte_id where r.id = p_id;
    if p_valeur is not null and ((v_tmax >= 0 and (p_valeur < -3 or p_valeur > 20)) or (v_tmax < 0 and (p_valeur < -40 or p_valeur > 15))) then
      raise exception 'Valeur corrigée impossible pour cette enceinte' using errcode = '22023';
    end if;
  elsif p_table = 'huiles' then
    select h.site_id into v_site from huiles h where h.id = p_id;
    if p_valeur is not null and (p_valeur < 0 or p_valeur > 40) then raise exception 'Valeur corrigée impossible (0 à 40 %%)' using errcode = '22023'; end if;
  elsif p_table = 'livraisons' then
    select l.site_id into v_site from livraisons l where l.id = p_id;
    if p_valeur is not null then raise exception 'Pas de valeur corrigée pour une livraison : motif seul' using errcode = '22023'; end if;
  else
    raise exception 'Type de saisie non corrigeable : %', p_table using errcode = '22023';
  end if;
  if v_site is null then raise exception 'Saisie introuvable' using errcode = '22023'; end if;
  insert into corrections (site_id, table_ref, ref_id, motif, valeur_corrigee, par)
  values (v_site, p_table, p_id, trim(p_motif), p_valeur, profil_siege()) returning id into v_id;
  return v_id;
end $$;

-- Dernière correction d'une saisie, au format des preuves.
create or replace function correction_de(p_table text, p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('motif', c.motif, 'valeur', c.valeur_corrigee, 'par', p.nom, 'at', c.at)
  from corrections c join profils p on p.id = c.par
  where c.table_ref = p_table and c.ref_id = p_id order by c.at desc limit 1
$$;

-- Preuves du jour : chaque relevé, mesure d'huile et livraison porte son id et sa correction éventuelle.
create or replace function preuves_jour(p_site uuid, p_jour date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare d timestamptz := (p_jour::timestamp at time zone 'Europe/Paris'); f timestamptz := ((p_jour + 1)::timestamp at time zone 'Europe/Paris');
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return jsonb_build_object(
    'taches', coalesce((select jsonb_agg(jsonb_build_object('titre', t.titre, 'echeance', t.echeance, 'faite_at', t.faite_at, 'par', p.nom) order by t.echeance)
      from taches t left join profils p on p.id = t.faite_par where t.site_id = p_site and t.jour = p_jour), '[]'),
    'releves', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'enceinte', e.nom, 'valeur', r.valeur, 't_max', r.t_max, 'conforme', r.conforme, 'action', r.action,
        'par', p.nom, 'at', r.at, 'correction', correction_de('releves', r.id)) order by r.at, e.ordre)
      from releves r join enceintes e on e.id = r.enceinte_id join profils p on p.id = r.par where r.site_id = p_site and r.at >= d and r.at < f), '[]'),
    'huiles', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'friteuse', fr.nom, 'polaires', h.polaires, 'filtrage', h.filtrage, 'changement', h.changement,
        'non_utilisee', h.non_utilisee, 'par', p.nom, 'at', h.at, 'correction', correction_de('huiles', h.id)) order by h.at, fr.nom)
      from huiles h join friteuses fr on fr.id = h.friteuse_id join profils p on p.id = h.par where h.site_id = p_site and h.at >= d and h.at < f), '[]'),
    'livraisons', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'fournisseur', fo.nom, 't_camion', l.t_camion, 't_frais', l.t_frais, 't_surgele', l.t_surgele, 'conforme', l.conforme,
        'motifs', l.motifs, 'action', l.action, 'viande', l.viande, 'origine_ok', l.origine_ok, 'photo_bl', l.photo_bl, 'photo_nc', l.photo_nc, 'range_at', l.range_at,
        'par', p.nom, 'at', l.at, 'correction', correction_de('livraisons', l.id)) order by l.at)
      from livraisons l join fournisseurs fo on fo.id = l.fournisseur_id join profils p on p.id = l.par where l.site_id = p_site and l.at >= d and l.at < f), '[]'),
    'produits', coalesce((select jsonb_agg(jsonb_build_object('famille', u.famille, 'service', u.service, 'photo', u.photo, 'par', p.nom, 'at', u.at) order by u.at)
      from utilisations u join profils p on p.id = u.par where u.site_id = p_site and u.at >= d and u.at < f), '[]'),
    'anomalies', coalesce((select jsonb_agg(jsonb_build_object('titre', a.titre, 'gravite', a.gravite, 'statut', a.statut, 'at', a.cree_at) order by a.cree_at)
      from anomalies a where a.site_id = p_site and a.cree_at >= d and a.cree_at < f), '[]')
  );
end $$;

-- État du jour : un relevé corrigé par le siège compte selon sa valeur corrigée (annulé : ne compte plus).
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
    (select count(*)::int from releves r where r.site_id = s.id and r.at >= d
      and coalesce((select c.valeur_corrigee is not null and c.valeur_corrigee > r.t_max from corrections c
                    where c.table_ref = 'releves' and c.ref_id = r.id order by c.at desc limit 1), not r.conforme)),
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

revoke execute on function siege_corriger(text, uuid, text, numeric), correction_de(text, uuid) from public, anon;
revoke execute on function correction_de(text, uuid) from authenticated;
grant execute on function siege_corriger(text, uuid, text, numeric) to authenticated;
