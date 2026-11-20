-- Retours terrain (20/11) : compteur de jours d'utilisation de la même huile (max 14 j),
-- friteuses mesurables séparément, et « non utilisée aujourd'hui ».

alter table huiles add column non_utilisee boolean not null default false;
alter table huiles add constraint non_utilisee_sans_mesure
  check (not non_utilisee or (polaires is null and not changement and not filtrage));

-- Durée maximale d'une même huile, réglable par le siège.
update reglages set valeur = valeur || '{"jours_max": 14}'::jsonb where cle = 'huile' and not valeur ? 'jours_max';

-- État de chaque friteuse du restaurant de la tablette :
--  jours_utilisation = jours (heure de Paris) où la friteuse a servi depuis le dernier changement d'huile, aujourd'hui compris s'il est déjà saisi ;
--  aujourd_hui_* = dernière saisie du jour (mesure ou « non utilisée »), pour ne pas redemander une friteuse déjà faite.
create or replace function etat_friteuses()
returns table (friteuse_id uuid, jours_utilisation int, dernier_changement timestamptz,
               aujourd_hui_at timestamptz, aujourd_hui_polaires numeric, aujourd_hui_non_utilisee boolean)
language sql stable security invoker set search_path = public as $$
  with f as (select id from friteuses where actif and (site_id = mon_site() or est_siege())),
  chg as (select h.friteuse_id, max(h.at) at from huiles h join f on f.id = h.friteuse_id where h.changement group by 1),
  jour as (
    select distinct on (h.friteuse_id) h.friteuse_id, h.at, h.polaires, h.non_utilisee
    from huiles h join f on f.id = h.friteuse_id
    where (h.at at time zone 'Europe/Paris')::date = (now() at time zone 'Europe/Paris')::date
    order by h.friteuse_id, h.at desc
  )
  select f.id,
    (select count(distinct (h.at at time zone 'Europe/Paris')::date)::int from huiles h
      where h.friteuse_id = f.id and not h.non_utilisee and h.at >= coalesce(chg.at, '-infinity')),
    chg.at, jour.at, jour.polaires, jour.non_utilisee
  from f left join chg on chg.friteuse_id = f.id left join jour on jour.friteuse_id = f.id
$$;
revoke execute on function etat_friteuses() from public, anon;
grant execute on function etat_friteuses() to authenticated;
