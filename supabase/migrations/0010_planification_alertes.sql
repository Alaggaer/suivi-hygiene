-- Envoi des alertes toutes les 5 min (juste après les relances) et résumé du soir à 21:00 UTC (22:00 Paris l'hiver, 23:00 l'été).
-- La fonction d'envoi n'utilise que la clé publique pour être appelée ; elle n'envoie que ce qui est en attente (rejouable).
create extension if not exists pg_net;
select cron.unschedule('escalader');
select cron.schedule('escalader-et-alertes', '*/5 * * * *', $$
  select public.escalader();
  select net.http_post(
    url := 'https://ldsxlovhueuzmhrzofjo.supabase.co/functions/v1/envoyer-alertes?mode=alertes',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxkc3hsb3ZodWV1em1ocnpvZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMzMyNTgsImV4cCI6MjExMDcwOTI1OH0.7vfkrpw-NoHncKchdT11f4RKio3pVHHtBRqr_Ix9JCk"}'::jsonb,
    body := '{}'::jsonb);
$$);
select cron.schedule('resume-du-soir', '0 21 * * *', $$
  select net.http_post(
    url := 'https://ldsxlovhueuzmhrzofjo.supabase.co/functions/v1/envoyer-alertes?mode=resume',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxkc3hsb3ZodWV1em1ocnpvZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMzMyNTgsImV4cCI6MjExMDcwOTI1OH0.7vfkrpw-NoHncKchdT11f4RKio3pVHHtBRqr_Ix9JCk"}'::jsonb,
    body := '{}'::jsonb);
$$);
