-- Espace PMS, troisième partie : le classeur des documents (plan HACCP, procédures, attestations, contrats…).
-- Documents du groupe (déposés par le siège, visibles par tous) et documents propres à chaque restaurant.
-- Rien n'est supprimé : un document remplacé est archivé. Rappel avant expiration (restaurant → responsable).

create table documents_types (
  cle text primary key,
  libelle text not null,
  rubrique text not null check (rubrique in ('haccp', 'formation', 'administratif', 'contrats', 'nuisibles', 'autre')),
  niveau text not null check (niveau in ('groupe', 'site')),   -- qui le fournit d'habitude
  obligatoire boolean not null default false,                -- attendu dans le classeur (liste de contrôle)
  expire boolean not null default false,                     -- date d'expiration à saisir
  ordre int not null default 0
);
alter table documents_types enable row level security;
create policy lire on documents_types for select to authenticated using (true);
create policy gerer on documents_types for all to authenticated using (est_siege()) with check (est_siege());

insert into documents_types (cle, libelle, rubrique, niveau, obligatoire, expire, ordre) values
  ('plan_haccp', 'Plan HACCP et analyse des dangers', 'haccp', 'groupe', true, false, 1),
  ('procedures', 'Procédures et bonnes pratiques d''hygiène', 'haccp', 'groupe', true, false, 2),
  ('plan_nettoyage', 'Plan de nettoyage et de désinfection', 'haccp', 'groupe', false, false, 3),
  ('tracabilite', 'Procédure de traçabilité et de retrait-rappel', 'haccp', 'groupe', true, false, 4),
  ('formation_hygiene', 'Attestation de formation à l''hygiène alimentaire', 'formation', 'site', true, false, 1),
  ('declaration_ddpp', 'Déclaration d''activité ou agrément (DDPP)', 'administratif', 'site', true, false, 1),
  ('eau_potable', 'Analyse d''eau ou attestation réseau public', 'administratif', 'site', false, true, 2),
  ('contrat_3d', 'Contrat de dératisation et désinsectisation', 'nuisibles', 'site', true, true, 1),
  ('plan_appats', 'Plan de positionnement des appâts', 'nuisibles', 'site', true, false, 2),
  ('contrat_eurofins', 'Contrat avec le laboratoire (Eurofins)', 'contrats', 'groupe', true, true, 1),
  ('contrat_hotte', 'Contrat d''entretien de la hotte et des conduits', 'contrats', 'site', false, true, 2),
  ('contrat_froid', 'Contrat de maintenance du froid', 'contrats', 'site', false, true, 3),
  ('autre', 'Autre document', 'autre', 'site', false, false, 99);

create table documents_pms (
  id uuid primary key,                  -- créé par la tablette ou le siège (renvoi sans doublon)
  site_id uuid references sites(id),    -- null : document du groupe, visible par tous les restaurants
  type_cle text not null references documents_types(cle),
  titre text not null check (length(trim(titre)) >= 2),
  fichier text not null,
  expire_le date,
  personne text,                        -- attestation de formation : qui est formé
  actif boolean not null default true,  -- false : archivé (remplacé ou retiré)
  remplace_id uuid references documents_pms(id),
  par uuid not null references profils(id),
  at timestamptz not null default now(),
  at_client timestamptz,
  archive_at timestamptz
);
create index on documents_pms (site_id, actif);
alter table documents_pms enable row level security;
create policy lire on documents_pms for select to authenticated using (est_siege() or site_id is null or site_id = mon_site());
-- Écriture seulement par les fonctions ci-dessous.

-- Déposer un document (et archiver celui qu'il remplace). Le siège : groupe ou n'importe quel restaurant ; la tablette : son restaurant.
create or replace function enregistrer_document(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := (p->>'id')::uuid; v_site uuid; v_par uuid; v_rempl uuid := (p->>'remplace')::uuid; v_ancien documents_pms;
begin
  if v_id is null then raise exception 'Document incomplet' using errcode = '22023'; end if;
  if est_siege() then v_site := (p->>'site_id')::uuid; v_par := profil_siege();
  else v_site := mon_site(); v_par := auteur_pms(v_site, (p->>'profil')::uuid); end if;
  if exists (select 1 from documents_pms where id = v_id) then return v_id; end if;
  if not exists (select 1 from documents_types where cle = p->>'type_cle') then raise exception 'Type de document inconnu' using errcode = '22023'; end if;
  if p->>'fichier' is null or p->>'fichier' !~ ('^(documents|' || coalesce(v_site::text, 'documents') || ')/') then
    raise exception 'Fichier mal placé' using errcode = '22023';
  end if;
  if v_rempl is not null then
    select * into v_ancien from documents_pms where id = v_rempl and actif;
    if v_ancien.id is null or v_ancien.site_id is distinct from v_site then raise exception 'Document à remplacer introuvable' using errcode = '22023'; end if;
    update documents_pms set actif = false, archive_at = now() where id = v_rempl;
  end if;
  insert into documents_pms (id, site_id, type_cle, titre, fichier, expire_le, personne, remplace_id, par, at_client)
  values (v_id, v_site, p->>'type_cle', trim(p->>'titre'), p->>'fichier', (p->>'expire_le')::date, nullif(trim(p->>'personne'), ''),
          v_rempl, v_par, (p->>'at_client')::timestamptz);
  return v_id;
end $$;

-- Retirer un document (archivé, jamais supprimé).
create or replace function archiver_document(p_id uuid, p_profil uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d documents_pms;
begin
  select * into d from documents_pms where id = p_id and actif;
  if d.id is null then raise exception 'Document introuvable' using errcode = 'P0002'; end if;
  if not est_siege() then
    if d.site_id is null then raise exception 'Document du groupe : réservé au siège' using errcode = '42501'; end if;
    perform auteur_pms(d.site_id, p_profil);
  end if;
  update documents_pms set actif = false, archive_at = now() where id = p_id;
end $$;

-- Classeur d'un restaurant : documents du groupe + les siens, état d'expiration, et la liste des documents attendus.
create or replace function documents_site(p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_auj date := (now() at time zone 'Europe/Paris')::date;
begin
  if not (est_siege() or p_site = mon_site()) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return jsonb_build_object(
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'groupe', d.site_id is null, 'type_cle', d.type_cle, 'type', t.libelle, 'rubrique', t.rubrique, 'titre', d.titre,
        'fichier', d.fichier, 'expire_le', d.expire_le, 'personne', d.personne, 'par', p.nom, 'at', d.at,
        'etat', case when d.expire_le is null then 'a_jour' when d.expire_le < v_auj then 'retard' when d.expire_le <= v_auj + 30 then 'bientot' else 'a_jour' end)
      order by t.rubrique, t.ordre, d.titre)
      from documents_pms d join documents_types t on t.cle = d.type_cle left join profils p on p.id = d.par
      where d.actif and (d.site_id is null or d.site_id = p_site)), '[]'::jsonb),
    'attendus', coalesce((select jsonb_agg(jsonb_build_object('cle', t.cle, 'libelle', t.libelle, 'rubrique', t.rubrique, 'niveau', t.niveau,
        'present', exists (select 1 from documents_pms d where d.actif and d.type_cle = t.cle and (d.site_id is null or d.site_id = p_site)
                           and (d.expire_le is null or d.expire_le >= v_auj)))
      order by t.rubrique, t.ordre)
      from documents_types t where t.obligatoire), '[]'::jsonb));
end $$;

-- Archives d'un restaurant (pour retrouver une ancienne version lors d'un contrôle).
create or replace function documents_archives(p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (est_siege() or p_site = mon_site()) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'groupe', d.site_id is null, 'type', t.libelle, 'titre', d.titre, 'fichier', d.fichier,
      'expire_le', d.expire_le, 'personne', d.personne, 'at', d.at, 'archive_at', d.archive_at) order by d.archive_at desc)
    from documents_pms d join documents_types t on t.cle = d.type_cle
    where not d.actif and (d.site_id is null or d.site_id = p_site)), '[]'::jsonb);
end $$;

-- Vue groupe : documents manquants ou expirés par restaurant.
create or replace function documents_groupe() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('site_id', s.id,
      'manquants', (select count(*) from jsonb_array_elements(x.c->'attendus') a where not (a->>'present')::boolean),
      'expires', (select count(*) from jsonb_array_elements(x.c->'documents') d where d->>'etat' = 'retard'),
      'bientot', (select count(*) from jsonb_array_elements(x.c->'documents') d where d->>'etat' = 'bientot'))
    order by s.nom)
    from sites s cross join lateral (select documents_site(s.id) c) x where s.actif), '[]'::jsonb);
end $$;

-- Rappel : document d'un restaurant qui expire dans 30 jours, puis expiré → responsable du site (une fois par palier).
create or replace function relancer_documents() returns int
language plpgsql security definer set search_path = public as $$
declare n int; v_auj date := (now() at time zone 'Europe/Paris')::date;
begin
  insert into notifications (site_id, destinataire, titre, ref_table, ref_id, niveau)
  select d.site_id, 'responsable',
    case when d.expire_le < v_auj then 'Document expiré : ' else 'Document à renouveler avant le ' || to_char(d.expire_le, 'DD/MM/YYYY') || ' : ' end || d.titre,
    'documents_pms', d.id, case when d.expire_le < v_auj then 2 else 1 end
  from documents_pms d
  where d.actif and d.site_id is not null and d.expire_le is not null and d.expire_le <= v_auj + 30
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function relancer_documents() from public, anon, authenticated;
revoke execute on function enregistrer_document(jsonb), archiver_document(uuid, uuid), documents_site(uuid), documents_archives(uuid), documents_groupe() from public, anon;
grant execute on function enregistrer_document(jsonb), archiver_document(uuid, uuid), documents_site(uuid), documents_archives(uuid), documents_groupe() to authenticated;
