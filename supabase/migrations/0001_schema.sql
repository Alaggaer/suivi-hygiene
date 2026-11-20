-- Suivi Hygiène — schéma initial (MVP)
-- Principes : 1 compte « tablette » par site (auth Supabase), l'identité de la personne passe par un PIN,
-- aucune suppression possible, toute modification est historisée dans journal.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- types
create type role_utilisateur as enum ('equipe', 'chef', 'responsable', 'siege');
create type gravite as enum ('mineure', 'majeure', 'critique');
create type statut_anomalie as enum ('ouverte', 'traitee', 'verifiee');
create type type_tache as enum ('releves', 'huile', 'nettoyage', 'dlc', 'stock_carte', 'autre');
create type type_minuteur as enum ('refroidissement', 'remise_temperature');

-- ---------------------------------------------------------------- référentiels
create table sites (
  id uuid primary key default gen_random_uuid(),
  nom text not null,                 -- ex. « DALLAS »
  ville text not null,               -- ex. « CHAMBRAY »
  ouverture time not null default '11:30',
  service_soir time not null default '18:30',
  drive_folder_id text,
  actif boolean not null default true
);

create table profils (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id),            -- null = siège
  nom text not null,
  role role_utilisateur not null default 'equipe',
  pin_hash text not null,                        -- crypt(pin, gen_salt('bf'))
  actif boolean not null default true
);

create table fournisseurs (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique,
  actif boolean not null default true
);

create table enceintes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  nom text not null,
  t_max numeric(4,1) not null,       -- ex. 3.0 pour une CF positive, -18.0 pour une CF négative
  ordre int not null default 0,
  actif boolean not null default true
);

create table friteuses (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  nom text not null,
  litres numeric(4,1) not null,
  actif boolean not null default true
);

-- Réglages groupe (seuils huile, délais d'escalade)
create table reglages (
  cle text primary key,
  valeur jsonb not null
);
insert into reglages values
  ('huile', '{"orange": 20, "rouge": 25}'),
  ('escalade_min', '{"chef": 30, "responsable": 120}'),
  ('anomalie_h', '{"majeure": 24, "mineure": 72}'),
  ('rangement_min', '15');

-- ---------------------------------------------------------------- tâches du jour
create table taches_modeles (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  type type_tache not null,
  titre text not null,
  heure_limite time not null,
  jours smallint[] not null default '{1,2,3,4,5,6,7}',  -- ISO : 1 = lundi
  actif boolean not null default true
);

create table taches (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  modele_id uuid references taches_modeles(id),
  type type_tache not null,
  titre text not null,
  jour date not null,
  echeance timestamptz not null,
  faite_at timestamptz,
  faite_par uuid references profils(id),
  escalade smallint not null default 0,   -- 0 rien, 1 chef prévenu, 2 responsable prévenu
  unique (modele_id, jour)
);

-- ---------------------------------------------------------------- saisies
create table releves (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  tache_id uuid references taches(id),
  enceinte_id uuid not null references enceintes(id),
  valeur numeric(4,1) not null,
  t_max numeric(4,1) not null,                       -- seuil au moment du relevé
  conforme boolean generated always as (valeur <= t_max) stored,
  action text,
  par uuid not null references profils(id),
  at timestamptz not null default now(),
  at_client timestamptz,
  constraint action_si_hors_seuil check (valeur <= t_max or action is not null)
);

create table huiles (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  tache_id uuid references taches(id),
  friteuse_id uuid not null references friteuses(id),
  polaires numeric(4,1),                 -- % de composés polaires (null si simple changement/filtrage)
  filtrage boolean not null default false,
  changement boolean not null default false,
  litres numeric(4,1),
  par uuid not null references profils(id),
  at timestamptz not null default now(),
  at_client timestamptz
);

create table livraisons (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  fournisseur_id uuid not null references fournisseurs(id),
  t_camion numeric(4,1) not null,
  t_frais numeric(4,1),
  t_surgele numeric(4,1),
  photo_bl text not null,                -- chemin dans le stockage
  viande boolean not null default false,
  origine_ok boolean,
  conforme boolean not null,
  motifs text[],
  action text,
  photo_nc text,
  range_at timestamptz,
  par uuid not null references profils(id),
  at timestamptz not null default now(),
  at_client timestamptz,
  constraint motif_si_nc check (conforme or (motifs is not null and action is not null))
);

create table utilisations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  photo text not null,
  famille text not null,
  service text not null check (service in ('midi', 'soir')),
  par uuid not null references profils(id),
  at timestamptz not null default now(),
  at_client timestamptz
);

create table minuteurs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  type type_minuteur not null,
  plat text not null,
  t_debut numeric(4,1) not null,
  debut_at timestamptz not null,
  t_fin numeric(4,1),
  fin_at timestamptz,
  conforme boolean,
  action text,
  par uuid not null references profils(id)
);

create table anomalies (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  source text not null,                  -- 'releve', 'huile', 'livraison', 'minuteur', 'tache', 'manuel'
  ref_id uuid,
  categorie text not null,
  gravite gravite not null,
  titre text not null,
  photo text,
  statut statut_anomalie not null default 'ouverte',
  cree_par uuid references profils(id),  -- null si créée automatiquement
  cree_at timestamptz not null default now(),
  traitee_par uuid references profils(id),
  traitee_at timestamptz,
  traitee_commentaire text,
  verifiee_par uuid references profils(id),
  verifiee_at timestamptz,
  escalade smallint not null default 0
);

create index on taches (site_id, jour);
create index on releves (site_id, at);
create index on huiles (site_id, at);
create index on livraisons (site_id, at);
create index on utilisations (site_id, at);
create index on anomalies (site_id, statut);

-- ---------------------------------------------------------------- journal + interdiction de supprimer
create table journal (
  id bigint generated always as identity primary key,
  tbl text not null,
  ref_id uuid,
  avant jsonb,
  apres jsonb,
  par text default auth.uid()::text,
  at timestamptz not null default now()
);

create function interdire_suppression() returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Suppression interdite sur % : corriger plutôt que supprimer', tg_table_name;
end $$;

create function historiser() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into journal (tbl, ref_id, avant, apres) values (tg_table_name, old.id, to_jsonb(old), to_jsonb(new));
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['taches','releves','huiles','livraisons','utilisations','minuteurs','anomalies'] loop
    execute format('create trigger %I_no_delete before delete on %I for each row execute function interdire_suppression()', t, t);
    execute format('create trigger %I_journal after update on %I for each row execute function historiser()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- sécurité (RLS)
-- Le site et le rôle du compte connecté sont posés dans app_metadata par le siège :
--   tablette : {"site_id": "<uuid>", "role": "tablette"} ; siège : {"role": "siege"}
create function mon_site() returns uuid language sql stable set search_path = public as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'site_id', '')::uuid
$$;
create function est_siege() returns boolean language sql stable set search_path = public as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'siege'
$$;

do $$
declare t text;
begin
  foreach t in array array['enceintes','friteuses','taches_modeles','taches','releves','huiles','livraisons','utilisations','minuteurs','anomalies'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy lire on %I for select using (est_siege() or site_id = mon_site())', t);
    execute format('create policy ecrire on %I for insert with check (est_siege() or site_id = mon_site())', t);
    execute format('create policy modifier on %I for update using (est_siege() or site_id = mon_site())', t);
  end loop;
end $$;

alter table sites enable row level security;
create policy lire on sites for select using (est_siege() or id = mon_site());
create policy gerer on sites for all using (est_siege()) with check (est_siege());

alter table fournisseurs enable row level security;
create policy lire on fournisseurs for select using (auth.role() = 'authenticated');
create policy gerer on fournisseurs for all using (est_siege()) with check (est_siege());

alter table reglages enable row level security;
create policy lire on reglages for select using (auth.role() = 'authenticated');
create policy gerer on reglages for all using (est_siege()) with check (est_siege());

-- Les PIN ne sont jamais lisibles : la tablette ne voit que nom/rôle, et vérifie un PIN par fonction.
alter table profils enable row level security;
create policy gerer on profils for all using (est_siege()) with check (est_siege());

create function profils_du_site() returns table (id uuid, nom text, role role_utilisateur)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.nom, p.role from profils p
  where p.actif and (p.site_id = mon_site() or (est_siege() and p.site_id is null))
  order by p.nom
$$;

create function verifier_pin(p_profil uuid, p_pin text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from profils p
    where p.id = p_profil and p.actif
      and (p.site_id = mon_site() or est_siege())
      and p.pin_hash = crypt(p_pin, p.pin_hash)
  )
$$;

-- ---------------------------------------------------------------- génération des tâches du jour
-- Appelée chaque nuit (pg_cron) et à l'ouverture de l'app.
create function generer_taches(p_jour date default (now() at time zone 'Europe/Paris')::date)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  insert into taches (site_id, modele_id, type, titre, jour, echeance)
  select m.site_id, m.id, m.type, m.titre, p_jour,
         (p_jour + m.heure_limite) at time zone 'Europe/Paris'
  from taches_modeles m
  where m.actif and extract(isodow from p_jour)::smallint = any (m.jours)
  on conflict (modele_id, jour) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
