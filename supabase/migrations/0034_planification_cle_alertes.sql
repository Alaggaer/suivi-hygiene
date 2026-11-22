-- La fonction d'envoi des e-mails n'accepte plus que les appels de la planification de la base :
-- une clé secrète, tirée au hasard dans la base et gardée dans le coffre (Vault), est jointe à chaque appel.
-- Elle ne sort jamais de la base : la fonction d'envoi la fait vérifier par verifier_cle_alertes() (clé de service).
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cle_alertes', 'Clé des appels à envoyer-alertes')
where not exists (select 1 from vault.secrets where name = 'cle_alertes');

create or replace function public.verifier_cle_alertes(p_cle text) returns boolean
language sql stable security definer set search_path = public, vault as $$
  select p_cle is not null and exists (select 1 from vault.decrypted_secrets where name = 'cle_alertes' and decrypted_secret = p_cle)
$$;
revoke execute on function public.verifier_cle_alertes(text) from public, anon, authenticated;
grant execute on function public.verifier_cle_alertes(text) to service_role;

select cron.schedule('escalader-et-alertes', '*/5 * * * *', $$
  select public.escalader();
  select net.http_post(
    url := 'https://ldsxlovhueuzmhrzofjo.supabase.co/functions/v1/envoyer-alertes?mode=alertes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxkc3hsb3ZodWV1em1ocnpvZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMzMyNTgsImV4cCI6MjExMDcwOTI1OH0.7vfkrpw-NoHncKchdT11f4RKio3pVHHtBRqr_Ix9JCk',
      'x-cle-alertes', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_alertes')),
    body := '{}'::jsonb);
$$);
select cron.schedule('resume-du-soir', '0 21 * * *', $$
  select net.http_post(
    url := 'https://ldsxlovhueuzmhrzofjo.supabase.co/functions/v1/envoyer-alertes?mode=resume',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxkc3hsb3ZodWV1em1ocnpvZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMzMyNTgsImV4cCI6MjExMDcwOTI1OH0.7vfkrpw-NoHncKchdT11f4RKio3pVHHtBRqr_Ix9JCk',
      'x-cle-alertes', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_alertes')),
    body := '{}'::jsonb);
$$);
select cron.schedule('surveiller-sauvegardes', '41 * * * *', $$
  select net.http_post(
    url := 'https://ldsxlovhueuzmhrzofjo.supabase.co/functions/v1/envoyer-alertes?mode=sauvegarde',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxkc3hsb3ZodWV1em1ocnpvZmpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMzMyNTgsImV4cCI6MjExMDcwOTI1OH0.7vfkrpw-NoHncKchdT11f4RKio3pVHHtBRqr_Ix9JCk',
      'x-cle-alertes', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_alertes')),
    body := '{}'::jsonb);
$$);
