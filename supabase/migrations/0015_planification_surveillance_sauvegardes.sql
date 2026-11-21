-- Vérification horaire des sauvegardes (à :41), par la fonction d'envoi des alertes.
select cron.schedule('surveiller-sauvegardes', '41 * * * *', $$
  select net.http_post(
    url := 'https://ldsxlovhueuzmhrzofjo.supabase.co/functions/v1/envoyer-alertes?mode=sauvegarde',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxkc3hsb3ZodWV1em1ocnpvZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMzMyNTgsImV4cCI6MjExMDcwOTI1OH0.7vfkrpw-NoHncKchdT11f4RKio3pVHHtBRqr_Ix9JCk"}'::jsonb,
    body := '{}'::jsonb);
$$);
