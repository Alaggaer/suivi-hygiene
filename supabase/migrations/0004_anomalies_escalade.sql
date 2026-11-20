-- Semaine 3 : cycle des anomalies et relances automatiques.

-- Ouverte → traitée (tout le monde) → vérifiée (chef, responsable, siège). Rejouer le même changement ne fait rien.
create function changer_statut_anomalie(p_anomalie uuid, p_statut statut_anomalie, p_profil uuid,
                                        p_commentaire text default null, p_at_client timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare a anomalies; r role_utilisateur; v_at timestamptz := now();
begin
  select * into a from anomalies where id = p_anomalie and (est_siege() or site_id = mon_site());
  if not found then raise exception 'Anomalie introuvable' using errcode = 'P0002'; end if;
  select role into r from profils where id = p_profil and actif and (site_id = a.site_id or site_id is null);
  if not found then raise exception 'Personne non autorisée sur ce site' using errcode = '42501'; end if;
  if a.statut = p_statut then return; end if;
  if p_at_client between now() - interval '24 hours' and now() then v_at := p_at_client; end if;
  if a.statut = 'ouverte' and p_statut = 'traitee' then
    update anomalies set statut = 'traitee', traitee_par = p_profil, traitee_at = v_at, traitee_commentaire = p_commentaire where id = a.id;
  elsif a.statut = 'traitee' and p_statut = 'verifiee' and r <> 'equipe' then
    update anomalies set statut = 'verifiee', verifiee_par = p_profil, verifiee_at = v_at where id = a.id;
  else
    raise exception 'Passage de « % » à « % » non autorisé', a.statut, p_statut using errcode = '42501';
  end if;
end $$;

-- File de notifications : remplie par escalader(), vidée par la fonction d'envoi (push / e-mail).
create table notifications (
  id bigint generated always as identity primary key,
  site_id uuid not null references sites(id),
  destinataire role_utilisateur not null,     -- chef, responsable ou siege
  titre text not null,
  ref_table text not null,
  ref_id uuid not null,
  niveau smallint not null,
  cree_at timestamptz not null default now(),
  envoyee_at timestamptz,
  unique (ref_table, ref_id, niveau)
);
alter table notifications enable row level security;
create policy lire on notifications for select using (est_siege() or site_id = mon_site());

-- Appelée toutes les 5 minutes (pg_cron). Ne crée chaque relance qu'une fois.
create function escalader() returns int language plpgsql security definer set search_path = public as $$
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

  return n;
end $$;

-- Planification (à exécuter une fois sur Supabase, où l'extension pg_cron est disponible) :
--   select cron.schedule('escalader', '*/5 * * * *', 'select escalader()');
--   select cron.schedule('taches-du-jour', '5 0 * * *', 'select generer_taches()');
