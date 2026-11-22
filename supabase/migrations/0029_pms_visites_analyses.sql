-- Espace PMS, deuxième partie : visites (Eurofins tous les 2 mois, services officiels, audits internes)
-- et analyses bactériologiques. Chaque écart de visite et chaque analyse non satisfaisante devient une action.
-- Clôture des actions (choix B) : écarts du quotidien → chef ou responsable ; écarts PMS majeurs et toute action critique → siège.

/* ---------- Clôture des actions (choix B) ---------- */
create or replace function cloture_reservee_siege(p_gravite gravite, p_source text) returns boolean
language sql immutable as $$
  select p_gravite = 'critique' or (p_gravite = 'majeure' and p_source in ('controle', 'metrologie', 'visite', 'analyse'))
$$;

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
  elsif a.statut = 'traitee' and p_statut = 'verifiee'
        and (r = 'siege' or (r in ('chef', 'responsable') and not cloture_reservee_siege(a.gravite, a.source))) then
    update anomalies set statut = 'verifiee', verifiee_par = p_profil, verifiee_at = v_at where id = a.id;
  elsif a.statut = 'traitee' and p_statut = 'verifiee' then
    raise exception 'Cette action doit être validée par le siège' using errcode = '42501';
  else
    raise exception 'Passage de « % » à « % » non autorisé', a.statut, p_statut using errcode = '42501';
  end if;
end $$;

/* ---------- Visites et analyses ---------- */
insert into reglages (cle, valeur) values ('visites', '{"eurofins_mois": 2}') on conflict (cle) do nothing;

create table visites (
  id uuid primary key,                         -- id créé par la tablette ou par le siège (renvoi sans doublon)
  site_id uuid not null references sites(id),
  type text not null check (type in ('eurofins', 'officielle', 'interne', 'autre')),
  date_visite date not null,
  organisme text,
  intervenant text,
  note numeric(5,1) check (note between 0 and 100),
  niveau text check (niveau in ('tres_satisfaisant', 'satisfaisant', 'a_ameliorer', 'a_corriger')),
  rapport text,
  commentaire text,
  par uuid not null references profils(id),
  at timestamptz not null default now(),
  at_client timestamptz
);
create index on visites (site_id, date_visite desc);
alter table visites enable row level security;
create policy lire on visites for select using (est_siege() or site_id = mon_site());
-- Écriture seulement par les fonctions ci-dessous.

create table analyses (
  id uuid primary key,
  site_id uuid not null references sites(id),
  visite_id uuid references visites(id),
  date_prelevement date not null,
  categorie text not null check (categorie in ('surface', 'produit', 'eau', 'autre')),
  objet text not null check (length(trim(objet)) >= 2),
  resultat text not null check (resultat in ('satisfaisant', 'acceptable', 'non_satisfaisant')),
  detail text,                                  -- germe, valeur, critère
  rapport text,
  par uuid not null references profils(id),
  at timestamptz not null default now()
);
create index on analyses (site_id, date_prelevement desc);
alter table analyses enable row level security;
create policy lire on analyses for select using (est_siege() or site_id = mon_site());

-- Qui saisit : le siège (n'importe quel restaurant), ou le chef / responsable sur la tablette de son restaurant.
create or replace function auteur_pms(p_site uuid, p_profil uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if est_siege() then return profil_siege(); end if;
  if p_site is distinct from mon_site() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if not exists (select 1 from profils where id = p_profil and site_id = p_site and actif and role in ('chef', 'responsable')) then
    raise exception 'Réservé au chef ou au responsable' using errcode = '42501';
  end if;
  return p_profil;
end $$;

create or replace function verifier_piece(p_site uuid, p_chemin text) returns void
language plpgsql immutable as $$
begin
  if p_chemin is not null and p_chemin !~ ('^(documents|' || p_site::text || ')/') then
    raise exception 'Pièce jointe mal placée' using errcode = '22023';
  end if;
end $$;

-- Analyses (avec la visite, ou plus tard quand les résultats arrivent). Non satisfaisante → action majeure.
create or replace function inserer_analyses(p_site uuid, p_visite uuid, p_par uuid, p_analyses jsonb, p_rapport text) returns int
language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0; v_id uuid; v_date date;
begin
  for x in select * from jsonb_array_elements(coalesce(p_analyses, '[]'::jsonb)) loop
    v_date := coalesce((x->>'date_prelevement')::date, (select date_visite from visites where id = p_visite));
    if v_date is null or v_date > (now() at time zone 'Europe/Paris')::date then raise exception 'Date de prélèvement invalide' using errcode = '22023'; end if;
    insert into analyses (id, site_id, visite_id, date_prelevement, categorie, objet, resultat, detail, rapport, par)
    values (coalesce((x->>'id')::uuid, gen_random_uuid()), p_site, p_visite, v_date, x->>'categorie', trim(x->>'objet'), x->>'resultat',
            nullif(trim(x->>'detail'), ''), p_rapport, p_par)
    on conflict (id) do nothing
    returning id into v_id;
    if v_id is not null then
      n := n + 1;
      if x->>'resultat' = 'non_satisfaisant' then
        insert into anomalies (site_id, source, ref_id, categorie, gravite, titre, cree_par)
        values (p_site, 'analyse', v_id, 'Analyse bactériologique', 'majeure',
                'Analyse non satisfaisante : ' || trim(x->>'objet') || coalesce(' (' || nullif(trim(x->>'detail'), '') || ')', ''), p_par);
      end if;
    end if;
  end loop;
  return n;
end $$;

-- Une visite, ses écarts (→ actions) et ses analyses, en une fois. Renvoyer la même visite ne crée rien de plus.
create or replace function enregistrer_visite(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := (p->>'id')::uuid; v_site uuid; v_par uuid; v_date date := (p->>'date_visite')::date; e jsonb;
begin
  v_site := case when est_siege() then (p->>'site_id')::uuid else mon_site() end;
  if v_id is null or v_site is null then raise exception 'Visite incomplète' using errcode = '22023'; end if;
  v_par := auteur_pms(v_site, (p->>'profil')::uuid);
  if exists (select 1 from visites where id = v_id) then return v_id; end if;
  if v_date is null or v_date > (now() at time zone 'Europe/Paris')::date or v_date < (now() at time zone 'Europe/Paris')::date - 400 then
    raise exception 'Date de visite invalide' using errcode = '22023';
  end if;
  perform verifier_piece(v_site, p->>'rapport');
  insert into visites (id, site_id, type, date_visite, organisme, intervenant, note, niveau, rapport, commentaire, par, at_client)
  values (v_id, v_site, p->>'type', v_date, nullif(trim(p->>'organisme'), ''), nullif(trim(p->>'intervenant'), ''),
          (p->>'note')::numeric, p->>'niveau', p->>'rapport', nullif(trim(p->>'commentaire'), ''), v_par, (p->>'at_client')::timestamptz);
  for e in select * from jsonb_array_elements(coalesce(p->'ecarts', '[]'::jsonb)) loop
    if length(trim(coalesce(e->>'texte', ''))) >= 3 then
      insert into anomalies (site_id, source, ref_id, categorie, gravite, titre, cree_par)
      values (v_site, 'visite', v_id,
              case p->>'type' when 'eurofins' then 'Visite Eurofins' when 'officielle' then 'Visite officielle' when 'interne' then 'Audit interne' else 'Visite' end,
              coalesce((e->>'gravite')::gravite, 'majeure'), trim(e->>'texte'), v_par);
    end if;
  end loop;
  perform inserer_analyses(v_site, v_id, v_par, p->'analyses', p->>'rapport');
  return v_id;
end $$;

-- Résultats d'analyses arrivés après la visite.
create or replace function ajouter_analyses(p_visite uuid, p_profil uuid, p_analyses jsonb, p_rapport text default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_site uuid; v_par uuid;
begin
  select site_id into v_site from visites where id = p_visite and (est_siege() or site_id = mon_site());
  if v_site is null then raise exception 'Visite introuvable' using errcode = 'P0002'; end if;
  v_par := auteur_pms(v_site, p_profil);
  perform verifier_piece(v_site, p_rapport);
  return inserer_analyses(v_site, p_visite, v_par, p_analyses, p_rapport);
end $$;

-- Visites d'un restaurant (24 derniers mois) et état de la visite Eurofins (dernière, prochaine, en retard).
create or replace function etat_visites(p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_auj date := (now() at time zone 'Europe/Paris')::date; v_mois int; v_der date;
begin
  if not (est_siege() or p_site = mon_site()) then raise exception 'Accès refusé' using errcode = '42501'; end if;
  v_mois := coalesce((select (valeur->>'eurofins_mois')::int from reglages where cle = 'visites'), 2);
  select max(date_visite) into v_der from visites where site_id = p_site and type = 'eurofins';
  return jsonb_build_object(
    'eurofins_mois', v_mois,
    'derniere_eurofins', v_der,
    'prochaine_eurofins', (v_der + make_interval(months => v_mois))::date,
    'etat_eurofins', case when v_der is null then 'jamais' when (v_der + make_interval(months => v_mois))::date < v_auj then 'retard'
                          when (v_der + make_interval(months => v_mois))::date <= v_auj + 15 then 'bientot' else 'a_jour' end,
    'visites', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'type', v.type, 'date_visite', v.date_visite, 'organisme', v.organisme, 'intervenant', v.intervenant,
        'note', v.note, 'niveau', v.niveau, 'rapport', v.rapport, 'commentaire', v.commentaire, 'par', p.nom,
        'ecarts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'titre', a.titre, 'gravite', a.gravite, 'statut', a.statut) order by a.cree_at)
                            from anomalies a where a.source = 'visite' and a.ref_id = v.id), '[]'::jsonb),
        'analyses', coalesce((select jsonb_agg(jsonb_build_object('id', an.id, 'date_prelevement', an.date_prelevement, 'categorie', an.categorie,
                              'objet', an.objet, 'resultat', an.resultat, 'detail', an.detail, 'rapport', an.rapport) order by an.date_prelevement, an.objet)
                              from analyses an where an.visite_id = v.id), '[]'::jsonb))
      order by v.date_visite desc, v.at desc)
      from visites v left join profils p on p.id = v.par
      where v.site_id = p_site and v.date_visite > v_auj - interval '24 months'), '[]'::jsonb));
end $$;

-- Vue groupe : avec l'état des visites.
create or replace function pms_groupe() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('site_id', s.id, 'restaurant', s.nom,
      'controles', etat_controles(s.id), 'metrologie', etat_metrologie(s.id), 'visites', etat_visites(s.id) - 'visites',
      'derniere_visite', (select jsonb_build_object('type', v.type, 'date_visite', v.date_visite, 'note', v.note, 'niveau', v.niveau)
                          from visites v where v.site_id = s.id order by v.date_visite desc limit 1),
      'analyses_non_satisfaisantes', (select count(*) from analyses an where an.site_id = s.id and an.resultat = 'non_satisfaisant'
                                       and an.date_prelevement > (now() at time zone 'Europe/Paris')::date - 90),
      'actions_ouvertes', (select count(*) from anomalies a where a.site_id = s.id and a.statut <> 'verifiee'),
      'actions_en_retard', (select count(*) from anomalies a where a.site_id = s.id and a.statut = 'ouverte'
                              and a.echeance < (now() at time zone 'Europe/Paris')::date),
      'actions_sans_plan', (select count(*) from anomalies a where a.site_id = s.id and a.statut = 'ouverte' and a.echeance is null))
    order by s.nom)
    from sites s where s.actif), '[]'::jsonb);
end $$;

-- Relance : visite Eurofins en retard → siège (une fois par échéance).
create or replace function relancer_visites() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into notifications (site_id, destinataire, titre, ref_table, ref_id, niveau)
  select s.id, 'siege', 'Visite Eurofins à programmer : dernière le ' || coalesce(to_char((e->>'derniere_eurofins')::date, 'DD/MM/YYYY'), 'jamais'),
         'visites', md5('eurofins' || s.id::text || coalesce(e->>'prochaine_eurofins', 'jamais'))::uuid, 1
  from sites s cross join lateral (select etat_visites_interne(s.id) e) x
  where s.actif and e->>'etat_eurofins' = 'retard'
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function etat_visites_interne(p_site uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (select coalesce((select (valeur->>'eurofins_mois')::int from reglages where cle = 'visites'), 2) m),
       d as (select max(date_visite) der from visites where site_id = p_site and type = 'eurofins')
  select jsonb_build_object('derniere_eurofins', d.der, 'prochaine_eurofins', (d.der + make_interval(months => r.m))::date,
    'etat_eurofins', case when d.der is null then 'jamais' when (d.der + make_interval(months => r.m))::date < (now() at time zone 'Europe/Paris')::date
                          then 'retard' else 'a_jour' end)
  from r, d
$$;

revoke execute on function inserer_analyses(uuid, uuid, uuid, jsonb, text), auteur_pms(uuid, uuid), relancer_visites(), etat_visites_interne(uuid)
  from public, anon, authenticated;
revoke execute on function enregistrer_visite(jsonb), ajouter_analyses(uuid, uuid, jsonb, text), etat_visites(uuid) from public, anon;
grant execute on function enregistrer_visite(jsonb), ajouter_analyses(uuid, uuid, jsonb, text), etat_visites(uuid) to authenticated;
