-- Corrections de sécurité issues de la revue de code (lot 1).
-- 1. Une tablette ne peut plus générer des tâches pour tout le groupe ni à n'importe quelle date.
-- 2. Une tablette ne peut plus signer au nom d'un compte siège.
-- 3. L'heure de réception et le motif de rattrapage sont fixés par le serveur, pas par la tablette.
-- 4. Une tablette ne peut plus créer d'anomalie « automatique » (tâche, rangement, PMS…) pour en neutraliser une.
-- 5. Les pièces propres à un restaurant déposées par le siège vont dans le dossier du restaurant (plus dans documents/).
-- 6. PIN tirés au hasard cryptographique ; droits d'exécution resserrés ; preuves non supprimables et journalisées.

/* ---------- 1. Génération des tâches ---------- */
revoke execute on function generer_taches(date) from authenticated;

-- Appelée par la tablette à l'ouverture : son restaurant seulement, aujourd'hui seulement.
create or replace function generer_taches_du_site() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare v_site uuid := mon_site(); v_jour date := (now() at time zone 'Europe/Paris')::date; n int; k int;
begin
  if v_site is null then return 0; end if;
  insert into taches (site_id, modele_id, type, titre, jour, echeance)
  select m.site_id, m.id, m.type, m.titre, v_jour, (v_jour + m.heure_limite) at time zone 'Europe/Paris'
  from taches_modeles m
  where m.site_id = v_site and m.actif and extract(isodow from v_jour)::smallint = any (m.jours)
  on conflict (modele_id, jour) do nothing;
  get diagnostics n = row_count;
  insert into taches (site_id, type, titre, jour, echeance, zone, elements)
  select v_site, 'nettoyage', 'Nettoyage ' || lower(e.zone), v_jour, (v_jour + e.heure_limite) at time zone 'Europe/Paris', e.zone,
         array_agg(e.id order by e.ordre, e.element)
  from nettoyage_prevu(v_site, v_jour) e
  where exists (select 1 from sites s where s.id = v_site and s.actif)
  group by e.zone, e.heure_limite
  on conflict (site_id, jour, zone, echeance) where zone is not null do nothing;
  get diagnostics k = row_count;
  return n + k;
end $$;
revoke execute on function generer_taches_du_site() from public, anon;
grant execute on function generer_taches_du_site() to authenticated;

/* ---------- 2 à 4. Contrôle des saisies ---------- */
create or replace function controler_saisie() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_par uuid; v_siege boolean := est_siege(); v_ligne jsonb := to_jsonb(new); v_patch jsonb := '{}'::jsonb;
begin
  v_par := (v_ligne ->> case tg_table_name when 'anomalies' then 'cree_par' else 'par' end)::uuid;
  -- La personne doit appartenir au restaurant ; un compte siège ne signe que depuis le siège.
  if v_par is not null and not exists (select 1 from profils p where p.id = v_par
       and (p.site_id = new.site_id or (p.site_id is null and v_siege))) then
    raise exception 'Cette personne n''appartient pas à ce restaurant' using errcode = '42501';
  end if;
  if not v_siege then
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
  elsif tg_table_name = 'anomalies' and not v_siege then
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

-- Mêmes règles pour les fonctions qui reçoivent la personne en paramètre.
create or replace function terminer_tache(p_tache uuid, p_profil uuid, p_at_client timestamptz default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_at timestamptz := now();
begin
  if p_at_client is not null and p_at_client between now() - interval '24 hours' and now() then
    v_at := p_at_client;   -- faite hors ligne : on retient l'heure réelle de la saisie
  end if;
  update taches set faite_at = v_at, faite_at_client = p_at_client, faite_par = p_profil
  where id = p_tache and faite_at is null
    and (est_siege() or site_id = mon_site())
    and exists (select 1 from profils p where p.id = p_profil and p.actif
                and (p.site_id = taches.site_id or (p.site_id is null and est_siege())));
end $$;

create or replace function changer_statut_anomalie(p_anomalie uuid, p_statut statut_anomalie, p_profil uuid,
                                                   p_commentaire text default null, p_at_client timestamptz default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare a anomalies; r role_utilisateur; v_at timestamptz := now();
begin
  select * into a from anomalies where id = p_anomalie and (est_siege() or site_id = mon_site());
  if not found then raise exception 'Anomalie introuvable' using errcode = 'P0002'; end if;
  select role into r from profils where id = p_profil and actif and (site_id = a.site_id or (site_id is null and est_siege()));
  if not found then raise exception 'Personne non autorisée sur ce site' using errcode = '42501'; end if;
  if a.statut = p_statut then return; end if;
  if p_at_client between now() - interval '24 hours' and now() then v_at := p_at_client; end if;
  if a.statut = 'ouverte' and p_statut = 'traitee' then
    update anomalies set statut = 'traitee', traitee_par = p_profil, traitee_at = v_at, traitee_commentaire = p_commentaire where id = a.id;
  elsif a.statut = 'traitee' and p_statut = 'verifiee'
        and (r = 'siege' or (r in ('chef', 'responsable') and not cloture_reservee_siege(a.gravite, a.source))) then
    update anomalies set statut = 'verifiee', verifiee_par = p_profil, verifiee_at = v_at where id = a.id;
  elsif a.statut = 'traitee' and p_statut = 'verifiee' then
    raise exception 'Cette action doit être validée par le siège' using errcode = '42501';
  else
    raise exception 'Passage de « % » à « % » non autorisé', a.statut, p_statut using errcode = '42501';
  end if;
end $$;

/* ---------- 5. Pièces des restaurants déposées par le siège ---------- */
create policy photos_envoyer_siege on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.est_siege()
              and (storage.foldername(name))[1] in (select id::text from public.sites));

create or replace function siege_enregistrer_controle(p_site uuid, p_modele uuid, p_date date, p_conforme boolean, p_observation text,
  p_prestataire text, p_document text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := gen_random_uuid();
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  perform verifier_piece(p_site, p_document);
  insert into controles_faits (id, site_id, modele_id, date_realisation, conforme, observation, prestataire, document, photo, par)
  values (v, p_site, p_modele, p_date, p_conforme, nullif(trim(p_observation), ''), nullif(trim(p_prestataire), ''), p_document,
          case when not p_conforme then p_document end, profil_siege());
  return v;
end $$;

/* ---------- 6. PIN, droits, preuves ---------- */
create or replace function pin_aleatoire() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare p text; b bytea;
begin
  loop
    b := gen_random_bytes(3);
    p := lpad(((get_byte(b, 0) * 65536 + get_byte(b, 1) * 256 + get_byte(b, 2)) % 10000)::text, 4, '0');
    exit when p !~ '^(\d)\1{3}$' and p not in ('1234', '4321', '0123', '9876', '2580');
  end loop;
  return p;
end $$;
revoke execute on function pin_aleatoire() from public, anon, authenticated;

-- Plus aucune fonction exécutable sans être connecté (le rôle anon n'en a besoin d'aucune).
do $$
declare f record; v_auth boolean;
begin
  for f in select p.oid, p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and pg_get_userbyid(p.proowner) = current_user
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    v_auth := has_function_privilege('authenticated', f.oid, 'EXECUTE');
    execute format('revoke execute on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke execute on function %s from anon', f.sig); end if;
    if v_auth then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

-- Les preuves ne se suppriment pas ; leurs modifications sont journalisées.
do $$
declare t text;
begin
  foreach t in array array['visites', 'analyses', 'controles_faits', 'verifications_mesure', 'nettoyages_faits', 'documents_pms',
                           'reponses_alerte', 'inventaires_stock', 'appareils_mesure', 'alertes_produit', 'produits_retires'] loop
    execute format('create trigger %I_no_delete before delete on %I for each row execute function interdire_suppression()', t, t);
    execute format('create trigger %I_journal after update on %I for each row execute function historiser()', t, t);
  end loop;
end $$;
