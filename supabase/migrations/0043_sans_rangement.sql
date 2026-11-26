-- Retour du chef exécutif : le rangement des livraisons n'est plus suivi (ni chrono, ni « C'est rangé »).
-- La tâche planifiée ne crée donc plus d'anomalie « Rangement non validé ». Les anciennes données restent (preuves).
-- marquer_rangee reste en place : une tablette pas encore à jour peut encore l'appeler sans erreur.
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

  return n;
end $$;
