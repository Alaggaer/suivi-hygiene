-- Correctif de la revue (0033) : les contrôles imposés aux saisies des tablettes s'appliquaient aussi
-- aux écritures du serveur. Conséquences corrigées ici :
--  * la tâche planifiée recréait une anomalie « Tâche non faite » toutes les 5 minutes (origine effacée, doublon non détecté) ;
--  * les anomalies nées d'un contrôle PMS, d'une sonde ou d'une analyse non conformes perdaient leur origine
--    (la règle « clôture par le siège » ne s'appliquait donc plus à elles).
create or replace function controler_saisie() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_par uuid; v_siege boolean := est_siege(); v_ligne jsonb := to_jsonb(new); v_patch jsonb := '{}'::jsonb;
  -- Saisie envoyée directement par une tablette (écriture dans la table) : on la contrôle.
  -- Ne sont PAS concernées les écritures faites par le serveur lui-même : tâches planifiées (pas de jeton),
  -- fonctions de l'app (/rpc/…) et suites automatiques d'une autre saisie (déclencheur imbriqué).
  -- Si le contexte est inconnu, on contrôle (prudence).
  v_tablette boolean := not v_siege and auth.jwt() is not null and pg_trigger_depth() <= 1
                        and coalesce(current_setting('request.path', true), '') not like '/rpc/%';
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

-- Nettoyage des doublons créés depuis le 22/11 à 23 h (UTC). Rien n'est supprimé (preuves) :
-- la première de chaque série retrouve son origine (la tâche) ; les copies sont fermées avec un commentaire explicite.
update anomalies a set source = 'tache', ref_id = x.tache_id
from (
  select distinct on (a2.site_id, a2.titre) a2.id,
    (select t.id from taches t
      where t.site_id = a2.site_id and a2.titre = 'Tâche non faite : ' || t.titre || ' (' || to_char(t.jour, 'DD/MM') || ')'
        and not exists (select 1 from anomalies y where y.source = 'tache' and y.ref_id = t.id)
      order by t.jour desc limit 1) as tache_id
  from anomalies a2
  where a2.source = 'manuel' and a2.ref_id is null and a2.cree_par is null
    and a2.titre like 'Tâche non faite : %' and a2.cree_at >= '2026-11-22 22:59:00+00'
  order by a2.site_id, a2.titre, a2.cree_at, a2.id
) x
where a.id = x.id and x.tache_id is not null;

update anomalies set statut = 'verifiee', traitee_at = now(), verifiee_at = now(),
  traitee_commentaire = 'Doublon créé par erreur technique (23/11), fermé automatiquement. L''anomalie d''origine reste ouverte.'
where source = 'manuel' and ref_id is null and cree_par is null and statut = 'ouverte'
  and titre like 'Tâche non faite : %' and cree_at >= '2026-11-22 22:59:00+00';
