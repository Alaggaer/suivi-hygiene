-- Revue : l'exemption « /rpc/… » couvrait aussi /rpc/graphql, par où une tablette pourrait écrire directement dans
-- les tables sans contrôle. pg_graphql n'est pas installé aujourd'hui ; on ferme la porte pour le jour où il le serait.
create or replace function controler_saisie() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_par uuid; v_siege boolean := est_siege(); v_ligne jsonb := to_jsonb(new); v_patch jsonb := '{}'::jsonb;
  -- Saisie envoyée directement par une tablette (écriture dans la table) : on la contrôle.
  -- Ne sont PAS concernées les écritures faites par le serveur lui-même : tâches planifiées (pas de jeton),
  -- fonctions de l'app (/rpc/…) et suites automatiques d'une autre saisie (déclencheur imbriqué).
  -- Si le contexte est inconnu, on contrôle (prudence). GraphQL (/rpc/graphql) écrit directement dans les tables : contrôlé.
  v_tablette boolean := not v_siege and auth.jwt() is not null and pg_trigger_depth() <= 1
                        and (coalesce(current_setting('request.path', true), '') not like '/rpc/%'
                             or current_setting('request.path', true) = '/rpc/graphql');
begin
  v_par := (v_ligne ->> case tg_table_name when 'anomalies' then 'cree_par' else 'par' end)::uuid;
  -- La personne doit appartenir au restaurant ; un compte siège ne signe que depuis le siège.
  if v_par is not null and not exists (select 1 from profils p where p.id = v_par
       and (p.site_id = new.site_id or (p.site_id is null and v_siege))) then
    raise exception 'Cette personne n''appartient pas à ce restaurant' using errcode = '42501';
  end if;
  if v_tablette then
    -- Heure de réception : celle du serveur. Heure de saisie : jamais dans le futur.
    if v_ligne ? 'at' then v_patch := v_patch || jsonb_build_object('at', now()); end if;
    if v_ligne ? 'at_client' and (v_ligne ->> 'at_client')::timestamptz > now() + interval '5 minutes' then
      v_patch := v_patch || jsonb_build_object('at_client', null);
    end if;
    -- Un rattrapage (saisie oubliée) ne vient que du siège.
    if v_ligne ? 'rattrapage_motif' then v_patch := v_patch || jsonb_build_object('rattrapage_motif', null); end if;
    if v_patch <> '{}'::jsonb then new := jsonb_populate_record(new, v_patch); end if;
  end if;
  if tg_table_name = 'releves' then
    -- Le seuil est celui de l'enceinte, pas celui envoyé par la tablette.
    select e.t_max into new.t_max from enceintes e where e.id = new.enceinte_id and e.site_id = new.site_id;
    if new.t_max is null then raise exception 'Enceinte inconnue pour ce restaurant' using errcode = '23503'; end if;
  elsif tg_table_name = 'huiles' then
    if not exists (select 1 from friteuses f where f.id = new.friteuse_id and f.site_id = new.site_id) then
      raise exception 'Friteuse inconnue pour ce restaurant' using errcode = '23503';
    end if;
  elsif tg_table_name = 'anomalies' and v_tablette then
    -- Une anomalie naît toujours « ouverte », sans plan d'action ; les origines automatiques sont réservées au serveur.
    new.statut := 'ouverte'; new.escalade := 0; new.cree_at := now();
    new.traitee_par := null; new.traitee_at := null; new.traitee_commentaire := null;
    new.verifiee_par := null; new.verifiee_at := null;
    new.action_prevue := null; new.echeance := null; new.responsable_id := null; new.preuve := null; new.echeance_relancee := false;
    if new.source is null or new.source not in ('releve', 'huile', 'livraison', 'minuteur', 'manuel') then
      new.source := 'manuel'; new.ref_id := null;
    end if;
    if new.cree_at_client > now() + interval '5 minutes' then new.cree_at_client := null; end if;
  end if;
  return new;
end $$;
