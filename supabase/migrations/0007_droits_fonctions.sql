-- Droits d'exécution : personne sans compte ne peut appeler de fonction ; les fonctions internes
-- (déclencheurs, relances) ne sont appelables par aucune tablette.
revoke execute on all functions in schema public from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon';
    execute 'alter default privileges in schema public revoke execute on functions from anon';
  end if;
end $$;
alter default privileges in schema public revoke execute on functions from public;

-- Appelées par l'app (tablettes et siège), toutes contrôlent elles-mêmes le site et le rôle.
grant execute on function
  mon_site(), est_siege(),
  profils_du_site(), verifier_pin(uuid, text), generer_taches(date), taches_du_jour(),
  terminer_tache(uuid, uuid, timestamptz), marquer_rangee(uuid, timestamptz),
  changer_statut_anomalie(uuid, statut_anomalie, uuid, text, timestamptz),
  tableau_siege(int), fournisseurs_non_conformes(int)
to authenticated;
-- controler_saisie(), historiser(), interdire_suppression() : déclencheurs seulement.
-- escalader() : planificateur (pg_cron) seulement.
-- Supabase accorde aussi l'exécution à « authenticated » par défaut : on la retire explicitement.
revoke execute on function controler_saisie(), historiser(), interdire_suppression(), escalader() from authenticated;
