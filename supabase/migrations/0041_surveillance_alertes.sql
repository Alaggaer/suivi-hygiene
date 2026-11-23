-- Surveillance de l'envoi des alertes e-mail : si la chaîne casse (planification, fonction d'envoi, Resend),
-- on le voit au siège (bandeau) et une vérification GitHub indépendante envoie un e-mail d'échec.
-- Sans cela, une panne des alertes serait silencieuse : plus d'e-mail, et personne pour s'en étonner.
create or replace function etat_alertes() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_succes int := 0; v_echecs int := 0; v_cron_echecs int := 0; v_derniere timestamptz; v_detail text;
  v_retard int; v_sans_dest int;
begin
  if not (est_siege() or session_user = 'sauvegarde') then   -- siège dans l'app, ou vérification GitHub (compte lecture seule)
    raise exception 'Réservé au siège' using errcode = '42501';
  end if;
  -- Réponses de la fonction d'envoi (pg_net les garde quelques heures).
  if to_regclass('net._http_response') is not null then
    execute $q$select count(*) filter (where status_code = 200 and error_msg is null),
                      count(*) filter (where status_code is distinct from 200 or error_msg is not null),
                      max(created) filter (where status_code = 200 and error_msg is null),
                      (array_agg(coalesce(error_msg, status_code::text || ' ' || left(content, 120)) order by created desc)
                         filter (where status_code is distinct from 200 or error_msg is not null))[1]
               from net._http_response where created > now() - interval '1 hour'$q$
      into v_succes, v_echecs, v_derniere, v_detail;
  end if;
  -- Exécutions ratées de la planification elle-même.
  if to_regclass('cron.job_run_details') is not null then
    execute $q$select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
               where j.jobname = 'escalader-et-alertes' and d.status = 'failed' and d.start_time > now() - interval '1 hour'$q$
      into v_cron_echecs;
  end if;
  -- Alertes qui auraient dû partir et ne sont pas parties (clé Resend absente, adresse refusée…).
  select count(*) filter (where coalesce(erreur, '') <> 'Aucun destinataire configuré'),
         count(*) filter (where erreur = 'Aucun destinataire configuré')
    into v_retard, v_sans_dest
  from notifications where envoyee_at is null and cree_at < now() - interval '30 minutes';
  return jsonb_build_object(
    'ok', v_succes > 0 and v_echecs = 0 and v_cron_echecs = 0 and v_retard = 0,
    'appels_reussis_1h', v_succes, 'appels_en_echec_1h', v_echecs, 'dernier_appel_reussi', v_derniere,
    'dernier_echec', v_detail, 'planification_en_echec_1h', v_cron_echecs,
    'alertes_non_envoyees', v_retard, 'alertes_sans_destinataire', v_sans_dest);
end $$;
revoke execute on function etat_alertes() from public, anon;
grant execute on function etat_alertes() to authenticated, sauvegarde;
