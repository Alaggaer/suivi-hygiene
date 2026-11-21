-- Espace PMS, première partie : plan d'action, contrôles périodiques (entretien technique, nuisibles), métrologie des sondes.
-- Tout écart (contrôle non conforme, sonde hors tolérance…) devient une action du plan d'action, c'est-à-dire une anomalie
-- avec une action prévue, un responsable, une échéance et une preuve de correction.

/* ---------- 1. Plan d'action ---------- */
alter table anomalies
  add column action_prevue text,
  add column echeance date,
  add column responsable_id uuid references profils(id),
  add column preuve text,
  add column echeance_relancee boolean not null default false;

-- Clôture : une action mineure peut être close par le chef ou le responsable du site ; majeure ou critique, par le siège.
create or replace function changer_statut_anomalie(p_anomalie uuid, p_statut statut_anomalie, p_profil uuid,
                                                   p_commentaire text default null, p_at_client timestamptz default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare a anomalies; r role_utilisateur; v_at timestamptz := now();
begin
  select * into a from anomalies where id = p_anomalie and (est_siege() or site_id = mon_site());
  if not found then raise exception 'Anomalie introuvable' using errcode = 'P0002'; end if;
  select role into r from profils where id = p_profil and actif and (site_id = a.site_id or site_id is null);
  if not found then raise exception 'Personne non autorisée sur ce site' using errcode = '42501'; end if;
  if a.statut = p_statut then return; end if;
  if p_at_client between now() - interval '24 hours' and now() then v_at := p_at_client; end if;
  if a.statut = 'ouverte' and p_statut = 'traitee' then
    update anomalies set statut = 'traitee', traitee_par = p_profil, traitee_at = v_at, traitee_commentaire = p_commentaire where id = a.id;
  elsif a.statut = 'traitee' and p_statut = 'verifiee' and (r = 'siege' or (a.gravite = 'mineure' and r in ('chef', 'responsable'))) then
    update anomalies set statut = 'verifiee', verifiee_par = p_profil, verifiee_at = v_at where id = a.id;
  elsif a.statut = 'traitee' and p_statut = 'verifiee' then
    raise exception 'Action % : la clôture revient au siège', a.gravite using errcode = '42501';
  else
    raise exception 'Passage de « % » à « % » non autorisé', a.statut, p_statut using errcode = '42501';
  end if;
end $$;

-- Correction avec sa preuve (photo prise sur la tablette, dans le dossier du restaurant).
create or replace function traiter_action(p_anomalie uuid, p_profil uuid, p_commentaire text, p_preuve text, p_at_client timestamptz default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_site uuid;
begin
  select site_id into v_site from anomalies where id = p_anomalie and (est_siege() or site_id = mon_site());
  if v_site is null then raise exception 'Anomalie introuvable' using errcode = 'P0002'; end if;
  if p_preuve is not null and p_preuve not like v_site::text || '/%' then raise exception 'Preuve mal placée' using errcode = '22023'; end if;
  perform changer_statut_anomalie(p_anomalie, 'traitee', p_profil, p_commentaire, p_at_client);
  if p_preuve is not null then update anomalies set preuve = p_preuve where id = p_anomalie; end if;
end $$;

-- Prévoir l'action : quoi, qui, pour quand (chef, responsable ou siège).
create or replace function planifier_action(p_anomalie uuid, p_profil uuid, p_action text, p_echeance date, p_responsable uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare a anomalies; r role_utilisateur;
begin
  select * into a from anomalies where id = p_anomalie and (est_siege() or site_id = mon_site());
  if not found then raise exception 'Anomalie introuvable' using errcode = 'P0002'; end if;
  if est_siege() then r := 'siege';
  else select role into r from profils where id = p_profil and actif and site_id = a.site_id; end if;
  if r is null or r = 'equipe' then raise exception 'Réservé au chef, au responsable ou au siège' using errcode = '42501'; end if;
  if a.statut = 'verifiee' then raise exception 'Action déjà close' using errcode = '22023'; end if;
  if length(trim(coalesce(p_action, ''))) < 3 then raise exception 'Décrivez l''action prévue' using errcode = '22023'; end if;
  if p_echeance is null or p_echeance < (now() at time zone 'Europe/Paris')::date - 1 then raise exception 'Échéance invalide' using errcode = '22023'; end if;
  if p_responsable is not null and not exists (select 1 from profils where id = p_responsable and actif and (site_id = a.site_id or site_id is null)) then
    raise exception 'Responsable inconnu sur ce site' using errcode = '22023';
  end if;
  update anomalies set action_prevue = trim(p_action), echeance = p_echeance, responsable_id = p_responsable,
    echeance_relancee = case when p_echeance is distinct from a.echeance then false else echeance_relancee end
  where id = a.id;
end $$;

-- Plan d'action d'un restaurant (tablette : le sien ; siège : n'importe lequel). Actions non closes + closes depuis 30 jours.
create or replace function plan_action(p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (est_siege() or p_site = mon_site()) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'titre', a.titre, 'categorie', a.categorie, 'gravite', a.gravite, 'statut', a.statut, 'source', a.source,
    'cree_at', a.cree_at, 'photo', a.photo, 'action_prevue', a.action_prevue, 'echeance', a.echeance,
    'responsable_id', a.responsable_id, 'responsable', pr.nom, 'preuve', a.preuve,
    'traitee_at', a.traitee_at, 'traitee_par', pt.nom, 'traitee_commentaire', a.traitee_commentaire,
    'verifiee_at', a.verifiee_at, 'verifiee_par', pv.nom)
    order by (a.statut = 'verifiee'), (a.echeance is null), a.echeance, a.cree_at desc)
    from anomalies a
    left join profils pr on pr.id = a.responsable_id left join profils pt on pt.id = a.traitee_par left join profils pv on pv.id = a.verifiee_par
    where a.site_id = p_site and (a.statut <> 'verifiee' or a.verifiee_at > now() - interval '30 days')), '[]'::jsonb);
end $$;

/* ---------- 2. Contrôles périodiques (entretien technique, nuisibles) ---------- */
create table controles_modeles (
  id uuid primary key default gen_random_uuid(),
  rubrique text not null check (rubrique in ('entretien', 'nuisibles')),
  titre text not null check (length(trim(titre)) >= 3),
  methode text,
  periodicite_mois smallint not null check (periodicite_mois in (1, 2, 3, 6, 12, 24)),
  preuve text not null default 'aucune' check (preuve in ('aucune', 'photo', 'document')),
  prestataire boolean not null default false,   -- fait par une entreprise extérieure (rapport, certificat)
  sites uuid[],
  ordre int not null default 0,
  actif boolean not null default true
);
alter table controles_modeles enable row level security;
create policy lire on controles_modeles for select to authenticated using (est_siege() or sites is null or mon_site() = any (sites));
create policy gerer on controles_modeles for all to authenticated using (est_siege()) with check (est_siege());

create table controles_faits (
  id uuid primary key,
  site_id uuid not null references sites(id),
  modele_id uuid not null references controles_modeles(id),
  date_realisation date not null,
  conforme boolean not null,
  observation text,
  prestataire text,
  photo text,
  document text,           -- PDF déposé par le siège (rapport, certificat)
  par uuid not null references profils(id),
  at timestamptz not null default now(),
  at_client timestamptz,
  constraint non_conforme_explique check (conforme or length(trim(coalesce(observation, ''))) >= 3)
);
create index on controles_faits (site_id, modele_id, date_realisation desc);
alter table controles_faits enable row level security;
create policy lire on controles_faits for select using (est_siege() or site_id = mon_site());
create policy ecrire on controles_faits for insert with check (site_id = mon_site());
create trigger controle before insert on controles_faits for each row execute function controler_saisie();

create or replace function verifier_controle() returns trigger
language plpgsql security definer set search_path = public as $$
declare m controles_modeles;
begin
  select * into m from controles_modeles where id = new.modele_id and (sites is null or new.site_id = any (sites));
  if m.id is null then raise exception 'Contrôle inconnu pour ce restaurant' using errcode = '23503'; end if;
  if new.date_realisation > (now() at time zone 'Europe/Paris')::date or new.date_realisation < (now() at time zone 'Europe/Paris')::date - 400 then
    raise exception 'Date de réalisation impossible' using errcode = '22023';
  end if;
  if m.preuve = 'photo' and new.photo is null then raise exception 'Photo obligatoire pour ce contrôle' using errcode = '23514'; end if;
  if m.preuve = 'document' and new.photo is null and new.document is null then
    raise exception 'Rapport ou certificat obligatoire (photo ou PDF)' using errcode = '23514';
  end if;
  if not new.conforme and new.photo is null then raise exception 'Photo obligatoire quand le contrôle n''est pas conforme' using errcode = '23514'; end if;
  return new;
end $$;
create trigger verifier before insert on controles_faits for each row execute function verifier_controle();

-- Non conforme → une action dans le plan d'action.
create or replace function action_depuis_controle() returns trigger
language plpgsql security definer set search_path = public as $$
declare m controles_modeles;
begin
  if new.conforme then return null; end if;
  select * into m from controles_modeles where id = new.modele_id;
  insert into anomalies (site_id, source, ref_id, categorie, gravite, titre, photo, cree_par)
  values (new.site_id, 'controle', new.id, case m.rubrique when 'nuisibles' then 'Nuisibles' else 'Entretien technique' end, 'majeure',
          m.titre || ' : ' || trim(new.observation), new.photo, new.par);
  return null;
end $$;
create trigger action after insert on controles_faits for each row execute function action_depuis_controle();

-- Le siège enregistre un contrôle pour un restaurant (ex. rapport du prestataire reçu par e-mail, en PDF).
create or replace function siege_enregistrer_controle(p_site uuid, p_modele uuid, p_date date, p_conforme boolean, p_observation text,
  p_prestataire text, p_document text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := gen_random_uuid();
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  if p_document is not null and p_document !~ '^documents/' then raise exception 'Document mal placé' using errcode = '22023'; end if;
  insert into controles_faits (id, site_id, modele_id, date_realisation, conforme, observation, prestataire, document, photo, par)
  values (v, p_site, p_modele, p_date, p_conforme, nullif(trim(p_observation), ''), nullif(trim(p_prestataire), ''), p_document,
          case when not p_conforme then p_document end, profil_siege());
  return v;
end $$;

-- État des contrôles d'un restaurant : dernier contrôle, prochaine date, à jour / bientôt / en retard / jamais fait.
create or replace function etat_controles(p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_auj date := (now() at time zone 'Europe/Paris')::date;
begin
  if not (est_siege() or p_site = mon_site()) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'rubrique', m.rubrique, 'titre', m.titre, 'methode', m.methode, 'periodicite_mois', m.periodicite_mois,
      'preuve', m.preuve, 'prestataire', m.prestataire,
      'dernier', case when d.id is null then null else jsonb_build_object('date', d.date_realisation, 'conforme', d.conforme,
        'observation', d.observation, 'prestataire', d.prestataire, 'photo', d.photo, 'document', d.document, 'par', p.nom) end,
      'prochaine', (d.date_realisation + make_interval(months => m.periodicite_mois))::date,
      'etat', case when d.id is null then 'jamais'
                   when (d.date_realisation + make_interval(months => m.periodicite_mois))::date < v_auj then 'retard'
                   when (d.date_realisation + make_interval(months => m.periodicite_mois))::date <= v_auj + 15 then 'bientot'
                   else 'a_jour' end)
    order by m.rubrique, m.ordre, m.titre)
    from controles_modeles m
    left join lateral (select * from controles_faits f where f.site_id = p_site and f.modele_id = m.id
                       order by f.date_realisation desc, f.at desc limit 1) d on true
    left join profils p on p.id = d.par
    where m.actif and (m.sites is null or p_site = any (m.sites))), '[]'::jsonb);
end $$;

/* ---------- 3. Métrologie : sondes et thermomètres ---------- */
create table appareils_mesure (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  nom text not null check (length(trim(nom)) >= 2),
  type text not null default 'sonde' check (type in ('sonde', 'infrarouge', 'enregistreur', 'autre')),
  numero text,
  hors_service boolean not null default false,
  actif boolean not null default true,
  cree_at timestamptz not null default now()
);
alter table appareils_mesure enable row level security;
create policy lire on appareils_mesure for select using (est_siege() or site_id = mon_site());
create policy gerer on appareils_mesure for all to authenticated using (est_siege()) with check (est_siege());

-- Le chef ou le responsable ajoute un appareil de son restaurant.
create or replace function ajouter_appareil(p_profil uuid, p_nom text, p_type text, p_numero text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; v_site uuid := mon_site();
begin
  if v_site is null then raise exception 'Réservé à une tablette de restaurant' using errcode = '42501'; end if;
  if not exists (select 1 from profils where id = p_profil and site_id = v_site and actif and role in ('chef', 'responsable')) then
    raise exception 'Réservé au chef ou au responsable' using errcode = '42501';
  end if;
  insert into appareils_mesure (site_id, nom, type, numero) values (v_site, trim(p_nom), p_type, nullif(trim(p_numero), '')) returning id into v;
  return v;
end $$;

create table verifications_mesure (
  id uuid primary key,
  site_id uuid not null references sites(id),
  appareil_id uuid not null references appareils_mesure(id),
  methode text not null check (methode in ('glace', 'ebullition', 'certificat')),
  valeur numeric(5,1),
  conforme boolean not null,
  photo text,
  document text,
  par uuid not null references profils(id),
  at timestamptz not null default now(),
  at_client timestamptz
);
create index on verifications_mesure (appareil_id, at desc);
alter table verifications_mesure enable row level security;
create policy lire on verifications_mesure for select using (est_siege() or site_id = mon_site());
create policy ecrire on verifications_mesure for insert with check (site_id = mon_site());
create trigger controle before insert on verifications_mesure for each row execute function controler_saisie();

-- Tolérances : glace fondante 0 °C ± 0,5 ; eau bouillante 100 °C ± 1. La conformité est calculée par le serveur.
create or replace function verifier_mesure() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from appareils_mesure where id = new.appareil_id and site_id = new.site_id) then
    raise exception 'Appareil inconnu pour ce restaurant' using errcode = '23503';
  end if;
  if new.photo is null and new.document is null then raise exception 'Photo obligatoire (appareil dans le bain, ou certificat)' using errcode = '23514'; end if;
  if new.methode = 'glace' then
    if new.valeur is null or new.valeur not between -20 and 20 then raise exception 'Valeur lue impossible' using errcode = '22023'; end if;
    new.conforme := abs(new.valeur) <= 0.5;
  elsif new.methode = 'ebullition' then
    if new.valeur is null or new.valeur not between 80 and 120 then raise exception 'Valeur lue impossible' using errcode = '22023'; end if;
    new.conforme := abs(new.valeur - 100) <= 1;
  end if;
  return new;
end $$;
create trigger verifier before insert on verifications_mesure for each row execute function verifier_mesure();

-- Résultat : l'appareil passe hors service (ou y revient) ; hors tolérance → une action.
create or replace function suite_verification_mesure() returns trigger
language plpgsql security definer set search_path = public as $$
declare a appareils_mesure;
begin
  update appareils_mesure set hors_service = not new.conforme where id = new.appareil_id returning * into a;
  if not new.conforme then
    insert into anomalies (site_id, source, ref_id, categorie, gravite, titre, photo, cree_par)
    values (new.site_id, 'metrologie', new.id, 'Métrologie', 'majeure',
            'Appareil hors tolérance : ' || a.nom || case new.methode when 'glace' then ' (lu ' || new.valeur || ' °C au lieu de 0)'
              when 'ebullition' then ' (lu ' || new.valeur || ' °C au lieu de 100)' else ' (certificat)' end,
            new.photo, new.par);
  end if;
  return null;
end $$;
create trigger suite after insert on verifications_mesure for each row execute function suite_verification_mesure();

create or replace function etat_metrologie(p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_auj date := (now() at time zone 'Europe/Paris')::date;
begin
  if not (est_siege() or p_site = mon_site()) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'nom', a.nom, 'type', a.type, 'numero', a.numero, 'hors_service', a.hors_service,
      'dernier', case when v.id is null then null else jsonb_build_object('date', (v.at at time zone 'Europe/Paris')::date, 'methode', v.methode,
        'valeur', v.valeur, 'conforme', v.conforme, 'photo', v.photo, 'document', v.document, 'par', p.nom) end,
      'prochaine', ((v.at at time zone 'Europe/Paris')::date + interval '12 months')::date,
      'etat', case when a.hors_service then 'hors_service' when v.id is null then 'jamais'
                   when ((v.at at time zone 'Europe/Paris')::date + interval '12 months')::date < v_auj then 'retard'
                   when ((v.at at time zone 'Europe/Paris')::date + interval '12 months')::date <= v_auj + 30 then 'bientot'
                   else 'a_jour' end)
    order by a.nom)
    from appareils_mesure a
    left join lateral (select * from verifications_mesure x where x.appareil_id = a.id order by x.at desc limit 1) v on true
    left join profils p on p.id = v.par
    where a.site_id = p_site and a.actif), '[]'::jsonb);
end $$;

/* ---------- 4. Vue groupe et relances ---------- */
create or replace function pms_groupe() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('site_id', s.id, 'restaurant', s.nom,
      'controles', etat_controles(s.id), 'metrologie', etat_metrologie(s.id),
      'actions_ouvertes', (select count(*) from anomalies a where a.site_id = s.id and a.statut <> 'verifiee'),
      'actions_en_retard', (select count(*) from anomalies a where a.site_id = s.id and a.statut = 'ouverte'
                              and a.echeance < (now() at time zone 'Europe/Paris')::date),
      'actions_sans_plan', (select count(*) from anomalies a where a.site_id = s.id and a.statut = 'ouverte' and a.echeance is null))
    order by s.nom)
    from sites s where s.actif), '[]'::jsonb);
end $$;

-- Une fois par jour : action dont l'échéance est passée → responsable du site ; contrôle ou sonde en retard → responsable.
create or replace function relancer_pms() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; k int; v_auj date := (now() at time zone 'Europe/Paris')::date;
begin
  with c as (
    update anomalies set echeance_relancee = true
    where statut = 'ouverte' and echeance < v_auj and not echeance_relancee returning *
  ) insert into notifications (site_id, destinataire, titre, ref_table, ref_id, niveau)
    select site_id, 'responsable', 'Action en retard : ' || coalesce(action_prevue, titre), 'anomalies', id, 3 from c on conflict do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into notifications (site_id, destinataire, titre, ref_table, ref_id, niveau)
  select s.id, 'responsable', 'Contrôle à faire : ' || (x->>'titre'), 'controles_modeles',
         md5(s.id::text || (x->>'id') || coalesce(x->>'prochaine', 'jamais'))::uuid, 1
  from sites s cross join lateral jsonb_array_elements(etat_controles_interne(s.id)) x
  where s.actif and x->>'etat' = 'retard'
  on conflict do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into notifications (site_id, destinataire, titre, ref_table, ref_id, niveau)
  select a.site_id, 'responsable', 'Vérification annuelle à faire : ' || a.nom, 'appareils_mesure',
         md5(a.id::text || coalesce(v.dt::text, 'jamais'))::uuid, 1
  from appareils_mesure a
  left join lateral (select (x.at at time zone 'Europe/Paris')::date dt from verifications_mesure x where x.appareil_id = a.id order by x.at desc limit 1) v on true
  where a.actif and not a.hors_service and v.dt is not null and (v.dt + interval '12 months')::date < v_auj
  on conflict do nothing;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- Même calcul qu'etat_controles, sans contrôle d'accès (usage interne par la relance planifiée).
create or replace function etat_controles_interne(p_site uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'titre', m.titre,
      'prochaine', (d.date_realisation + make_interval(months => m.periodicite_mois))::date,
      'etat', case when d.date_realisation is null then 'jamais'
                   when (d.date_realisation + make_interval(months => m.periodicite_mois))::date < (now() at time zone 'Europe/Paris')::date then 'retard'
                   else 'a_jour' end)), '[]'::jsonb)
  from controles_modeles m
  left join lateral (select f.date_realisation from controles_faits f where f.site_id = p_site and f.modele_id = m.id
                     order by f.date_realisation desc limit 1) d on true
  where m.actif and (m.sites is null or p_site = any (m.sites))
$$;

revoke execute on function verifier_controle(), action_depuis_controle(), verifier_mesure(), suite_verification_mesure(),
  relancer_pms(), etat_controles_interne(uuid) from public, anon, authenticated;
revoke execute on function traiter_action(uuid, uuid, text, text, timestamptz), planifier_action(uuid, uuid, text, date, uuid),
  plan_action(uuid), siege_enregistrer_controle(uuid, uuid, date, boolean, text, text, text), etat_controles(uuid),
  ajouter_appareil(uuid, text, text, text), etat_metrologie(uuid), pms_groupe() from public, anon;
grant execute on function traiter_action(uuid, uuid, text, text, timestamptz), planifier_action(uuid, uuid, text, date, uuid),
  plan_action(uuid), siege_enregistrer_controle(uuid, uuid, date, boolean, text, text, text), etat_controles(uuid),
  ajouter_appareil(uuid, text, text, text), etat_metrologie(uuid), pms_groupe() to authenticated;

-- Contrôles de départ, à corriger par le siège.
insert into controles_modeles (rubrique, titre, methode, periodicite_mois, preuve, prestataire, ordre) values
  ('entretien', 'Nettoyage des condenseurs des groupes froids', 'Couper le groupe, brosser et aspirer les ailettes, vérifier que rien ne gêne la ventilation', 3, 'photo', false, 1),
  ('entretien', 'Hotte et conduits d''extraction : dégraissage complet', 'Par une entreprise spécialisée ; garder le certificat (risque incendie et retombées de graisse)', 6, 'document', true, 2),
  ('entretien', 'Maintenance des groupes froids par le frigoriste', 'Contrôle d''étanchéité et rapport d''intervention', 12, 'document', true, 3),
  ('entretien', 'Joints des portes des enceintes froides', 'Joints entiers, souples, sans moisissure ; la porte ferme seule et reste fermée', 1, 'aucune', false, 4),
  ('entretien', 'Sols, murs et plafonds', 'Carrelage non fissuré, joints complets, pas de peinture qui s''écaille au-dessus des plans de travail', 1, 'aucune', false, 5),
  ('entretien', 'Siphons et caniveaux', 'Grilles en place, siphons propres, pas d''odeur ni de stagnation', 1, 'aucune', false, 6),
  ('entretien', 'Bac à graisse : vidange', 'Par une entreprise agréée ; garder le bon d''enlèvement', 6, 'document', true, 7),
  ('nuisibles', 'Passage du prestataire de dératisation et désinsectisation', 'Joindre le rapport de passage ; toute remarque du prestataire devient une action', 3, 'document', true, 1),
  ('nuisibles', 'Postes d''appâts : présence et état selon le plan', 'Chaque poste du plan est en place, numéroté, intact ; signaler toute consommation', 1, 'aucune', false, 2),
  ('nuisibles', 'Moustiquaires', 'Présentes sur les ouvrants, sans trou, propres', 1, 'aucune', false, 3),
  ('nuisibles', 'Bas de portes et ouvertures', 'Bas de portes étanches (brosses en place), pas de jour sous les portes ni de trou dans les murs', 1, 'aucune', false, 4);

-- Les actions en cours restent comme avant : aucune n'a encore d'échéance.
