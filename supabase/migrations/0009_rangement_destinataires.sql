-- Retours du premier test réel (20/11) : rangement non validé, et envoi des alertes.

create or replace function escalader() returns int language plpgsql security definer set search_path = public, extensions as $$
declare n int := 0; k int; e jsonb; h jsonb;
begin
  select valeur into e from reglages where cle = 'escalade_min';
  select valeur into h from reglages where cle = 'anomalie_h';

  -- Tâches en retard : chef à +30 min, responsable à +2 h ; non faite en fin de journée → anomalie.
  with c as (
    update taches t set escalade = 1
    where faite_at is null and escalade < 1 and now() > echeance + make_interval(mins => (e->>'chef')::int)
    returning t.*
  ) insert into notifications (site_id, destinataire, titre, ref_table, ref_id, niveau)
    select site_id, 'chef', 'En retard : ' || titre, 'taches', id, 1 from c on conflict do nothing;
  get diagnostics k = row_count; n := n + k;

  with c as (
    update taches t set escalade = 2
    where faite_at is null and escalade < 2 and now() > echeance + make_interval(mins => (e->>'responsable')::int)
    returning t.*
  ) insert into notifications (site_id, destinataire, titre, ref_table, ref_id, niveau)
    select site_id, 'responsable', 'Toujours pas fait : ' || titre, 'taches', id, 2 from c on conflict do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into anomalies (site_id, source, ref_id, categorie, gravite, titre)
  select t.site_id, 'tache', t.id, 'Tâche non faite', 'majeure', 'Tâche non faite : ' || t.titre || ' (' || to_char(t.jour, 'DD/MM') || ')'
  from taches t
  where t.faite_at is null and t.jour < (now() at time zone 'Europe/Paris')::date
    and not exists (select 1 from anomalies a where a.source = 'tache' and a.ref_id = t.id);
  get diagnostics k = row_count; n := n + k;

  -- Anomalies : critique → siège tout de suite ; majeure non traitée sous 24 h, mineure sous 72 h → siège.
  insert into notifications (site_id, destinataire, titre, ref_table, ref_id, niveau)
  select site_id, 'siege', 'Critique : ' || titre, 'anomalies', id, 1
  from anomalies where gravite = 'critique' and statut = 'ouverte'
  on conflict do nothing;
  get diagnostics k = row_count; n := n + k;

  with c as (
    update anomalies a set escalade = 1
    where statut = 'ouverte' and escalade < 1 and gravite <> 'critique'
      and now() > cree_at + make_interval(hours => (h->>(gravite::text))::int)
    returning a.*
  ) insert into notifications (site_id, destinataire, titre, ref_table, ref_id, niveau)
    select site_id, 'siege', 'Non traitée : ' || titre, 'anomalies', id, 2 from c on conflict do nothing;
  get diagnostics k = row_count; n := n + k;

  -- Livraison jamais validée comme rangée : anomalie 45 min après la réception (15 min de délai + 30 min de tolérance).
  insert into anomalies (site_id, source, ref_id, categorie, gravite, titre)
  select l.site_id, 'rangement', l.id, 'Livraison', 'mineure',
         'Rangement non validé · livraison ' || f.nom || ' de ' || to_char(l.at at time zone 'Europe/Paris', 'HH24:MI')
  from livraisons l join fournisseurs f on f.id = l.fournisseur_id
  where l.range_at is null and l.at < now() - interval '45 minutes'
    and not exists (select 1 from anomalies a where a.source = 'rangement' and a.ref_id = l.id);
  get diagnostics k = row_count; n := n + k;

  return n;
end $$;
revoke execute on function escalader() from public, authenticated;

-- Qui reçoit quoi. site_id vide = tous les restaurants (siège).
create table destinataires (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id),
  role role_utilisateur not null,          -- chef, responsable ou siege : mêmes niveaux que les notifications
  nom text not null,
  email text not null check (email like '%_@_%'),
  resume_quotidien boolean not null default true,
  actif boolean not null default true
);
alter table destinataires enable row level security;
create policy gerer on destinataires for all using (est_siege()) with check (est_siege());

alter table notifications add column tentatives smallint not null default 0, add column erreur text;

-- Résumé de la journée par restaurant, pour l'e-mail du soir (appelé par la fonction d'envoi, jamais par une tablette).
create function resume_jour()
returns table (site_id uuid, nom text, ville text, taches_total int, taches_faites int, taches_a_lheure int,
               non_faites text[], anomalies_ouvertes int, critiques text[], livraisons int, livraisons_nc int)
language sql stable security definer set search_path = public, extensions as $$
  with j as (select (now() at time zone 'Europe/Paris')::date as jour)
  select s.id, s.nom, s.ville,
    (select count(*)::int from taches t, j where t.site_id = s.id and t.jour = j.jour),
    (select count(*)::int from taches t, j where t.site_id = s.id and t.jour = j.jour and t.faite_at is not null),
    (select count(*)::int from taches t, j where t.site_id = s.id and t.jour = j.jour and t.faite_at <= t.echeance),
    (select coalesce(array_agg(t.titre order by t.echeance), '{}') from taches t, j where t.site_id = s.id and t.jour = j.jour and t.faite_at is null and t.echeance <= now()),
    (select count(*)::int from anomalies a where a.site_id = s.id and a.statut = 'ouverte'),
    (select coalesce(array_agg(a.titre order by a.cree_at), '{}') from anomalies a where a.site_id = s.id and a.statut = 'ouverte' and a.gravite = 'critique'),
    (select count(*)::int from livraisons l, j where l.site_id = s.id and (l.at at time zone 'Europe/Paris')::date = j.jour),
    (select count(*)::int from livraisons l, j where l.site_id = s.id and (l.at at time zone 'Europe/Paris')::date = j.jour and not l.conforme)
  from sites s where s.actif order by s.nom
$$;
revoke execute on function resume_jour() from public, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function resume_jour() to service_role';
  end if;
end $$;
