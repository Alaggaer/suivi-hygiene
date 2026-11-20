-- Planification sur Supabase (extension pg_cron) : relances toutes les 5 minutes, tâches du lendemain générées la nuit.
create extension if not exists pg_cron;
select cron.schedule('escalader', '*/5 * * * *', 'select public.escalader()');
select cron.schedule('taches-du-jour', '5 23 * * *', $$select public.generer_taches(((now() + interval '2 hours') at time zone 'Europe/Paris')::date)$$);
