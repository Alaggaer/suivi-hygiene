-- Alertes produit envoyées par le siège aux restaurants : prolongation de DDM, retrait demandé par le fournisseur.
-- Le siège joint le document du fournisseur ; chaque restaurant répond « aucun lot » ou identifie les lots trouvés
-- (n° de lot, quantité, photo de l'étiquette) et ce qu'il en a fait (photo). Sans réponse : relance au siège.

create table alertes_produit (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('prolongation', 'retrait')),
  produit text not null check (length(trim(produit)) >= 2),
  fournisseur_id uuid references fournisseurs(id),
  lots text,                                  -- lots concernés d'après le fournisseur (texte libre)
  ddm_origine date,
  ddm_nouvelle date,
  date_est_ddm boolean not null default false, -- le siège confirme qu'il s'agit d'une DDM (une DLC ne se prolonge pas)
  consigne text,
  document text,                              -- chemin dans le stockage photos/alertes/…
  document_type text,
  sites uuid[],                               -- null : tous les restaurants actifs
  cree_par uuid not null references profils(id),
  cree_at timestamptz not null default now(),
  clos_at timestamptz,
  constraint prolongation_ddm check (type <> 'prolongation'
    or (date_est_ddm and ddm_nouvelle is not null and (ddm_origine is null or ddm_nouvelle > ddm_origine)))
);
alter table alertes_produit enable row level security;
create policy lire on alertes_produit for select to authenticated
  using (est_siege() or sites is null or mon_site() = any (sites));
-- Écriture seulement par les fonctions du siège.

create table reponses_alerte (
  id uuid primary key,                        -- id créé par la tablette (renvoi sans doublon)
  alerte_id uuid not null references alertes_produit(id),
  site_id uuid not null references sites(id),
  trouve boolean not null,
  lot text,
  quantite text,
  photo text,                                 -- étiquette avec le n° de lot
  action text check (action in ('reetiquete', 'isole', 'repris', 'detruit')),
  photo_action text,                          -- produit réétiqueté, isolé, bon de reprise ou destruction
  par uuid not null references profils(id),
  at timestamptz not null default now(),
  at_client timestamptz,
  constraint trouve_complet check (not trouve
    or (lot is not null and quantite is not null and photo is not null and action is not null and photo_action is not null))
);
create index on reponses_alerte (alerte_id, site_id);
alter table reponses_alerte enable row level security;
create policy lire on reponses_alerte for select using (est_siege() or site_id = mon_site());
create policy ecrire on reponses_alerte for insert with check (site_id = mon_site());
create trigger controle before insert on reponses_alerte for each row execute function controler_saisie();

-- La réponse doit correspondre à une alerte ouverte qui concerne ce restaurant, et l'action au type d'alerte.
create or replace function controler_reponse_alerte() returns trigger
language plpgsql security definer set search_path = public as $$
declare a alertes_produit;
begin
  select * into a from alertes_produit where id = new.alerte_id;
  if a.id is null or (a.sites is not null and not new.site_id = any (a.sites)) then
    raise exception 'Cette alerte ne concerne pas ce restaurant' using errcode = '23503';
  end if;
  if a.clos_at is not null and a.clos_at < now() - interval '1 hour' then   -- tolère une réponse partie hors ligne juste avant la clôture
    raise exception 'Cette alerte est close' using errcode = '22023';
  end if;
  if new.trouve and ((a.type = 'prolongation') <> (new.action = 'reetiquete')) then
    raise exception 'Action incompatible avec ce type d''alerte' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger controle_alerte before insert on reponses_alerte for each row execute function controler_reponse_alerte();

-- Délai de réponse, en heures, avant relance au siège.
create or replace function delai_alerte(p_type text) returns int language sql immutable as $$
  select case p_type when 'retrait' then 4 else 24 end
$$;

-- Tablette : les alertes ouvertes qui concernent ce restaurant, avec ses réponses.
create or replace function alertes_du_site()
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'type', a.type, 'produit', a.produit, 'fournisseur', f.nom, 'lots', a.lots,
    'ddm_origine', a.ddm_origine, 'ddm_nouvelle', a.ddm_nouvelle, 'consigne', a.consigne,
    'document', a.document, 'document_type', a.document_type, 'cree_at', a.cree_at,
    'echeance', a.cree_at + make_interval(hours => delai_alerte(a.type)),
    'reponses', coalesce((select jsonb_agg(jsonb_build_object('trouve', r.trouve, 'lot', r.lot, 'quantite', r.quantite, 'action', r.action, 'at', r.at) order by r.at)
                          from reponses_alerte r where r.alerte_id = a.id and r.site_id = mon_site()), '[]'::jsonb)
  ) order by a.type desc, a.cree_at), '[]'::jsonb)   -- « retrait » avant « prolongation »
  from alertes_produit a left join fournisseurs f on f.id = a.fournisseur_id
  where a.clos_at is null and (a.sites is null or mon_site() = any (a.sites))
$$;

-- Siège : créer une alerte (le document est déposé avant, dans photos/alertes/).
create or replace function siege_creer_alerte(p_type text, p_produit text, p_fournisseur uuid, p_lots text,
  p_ddm_origine date, p_ddm_nouvelle date, p_date_est_ddm boolean, p_consigne text,
  p_document text, p_document_type text, p_sites uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  if p_type = 'prolongation' and not coalesce(p_date_est_ddm, false) then
    raise exception 'Une DLC ne peut pas être prolongée : seule une DDM peut l''être' using errcode = '22023';
  end if;
  if p_document is not null and p_document !~ '^alertes/' then raise exception 'Document mal placé' using errcode = '22023'; end if;
  insert into alertes_produit (type, produit, fournisseur_id, lots, ddm_origine, ddm_nouvelle, date_est_ddm, consigne,
    document, document_type, sites, cree_par)
  values (p_type, trim(p_produit), p_fournisseur, nullif(trim(p_lots), ''), p_ddm_origine, p_ddm_nouvelle, coalesce(p_date_est_ddm, false),
    nullif(trim(p_consigne), ''), p_document, p_document_type, nullif(p_sites, '{}'), profil_siege())
  returning id into v;
  -- Prévenir tout de suite chaque restaurant concerné (responsable, sinon siège).
  insert into notifications (site_id, destinataire, titre, ref_table, ref_id, niveau)
  select s.id, 'responsable',
    case p_type when 'retrait' then 'Retrait produit à vérifier : ' else 'Prolongation DDM à appliquer : ' end || trim(p_produit),
    'alertes_produit', md5(v::text || s.id::text)::uuid, 1
  from sites s where s.actif and (p_sites is null or p_sites = '{}' or s.id = any (p_sites))
  on conflict do nothing;
  return v;
end $$;

create or replace function siege_clore_alerte(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  update alertes_produit set clos_at = now() where id = p_id and clos_at is null;
end $$;

-- Siège : suivi par alerte et par restaurant.
create or replace function alertes_siege()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'type', a.type, 'produit', a.produit, 'fournisseur', f.nom, 'lots', a.lots,
      'ddm_origine', a.ddm_origine, 'ddm_nouvelle', a.ddm_nouvelle, 'consigne', a.consigne,
      'document', a.document, 'document_type', a.document_type, 'cree_at', a.cree_at, 'clos_at', a.clos_at,
      'echeance', a.cree_at + make_interval(hours => delai_alerte(a.type)),
      'sites', (select jsonb_agg(jsonb_build_object(
          'site_id', s.id, 'restaurant', s.nom,
          'reponses', coalesce((select jsonb_agg(jsonb_build_object(
              'trouve', r.trouve, 'lot', r.lot, 'quantite', r.quantite, 'photo', r.photo, 'action', r.action,
              'photo_action', r.photo_action, 'par', p.nom, 'at', heure_effective(r.at, r.at_client)) order by r.at)
            from reponses_alerte r left join profils p on p.id = r.par
            where r.alerte_id = a.id and r.site_id = s.id), '[]'::jsonb)) order by s.nom)
        from sites s where s.actif and (a.sites is null or s.id = any (a.sites)))
    ) order by (a.clos_at is null) desc, a.cree_at desc)
    from alertes_produit a left join fournisseurs f on f.id = a.fournisseur_id
    where a.clos_at is null or a.clos_at > now() - interval '30 days'), '[]'::jsonb);
end $$;

-- Relance : restaurant sans réponse après le délai → e-mail au siège (une fois par alerte et par restaurant).
create or replace function relancer_alertes_produit() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into notifications (site_id, destinataire, titre, ref_table, ref_id, niveau)
  select s.id, 'siege',
    'Sans réponse : ' || case a.type when 'retrait' then 'retrait de ' else 'prolongation DDM de ' end || a.produit,
    'alertes_produit', md5(a.id::text || s.id::text)::uuid, 2
  from alertes_produit a join sites s on s.actif and (a.sites is null or s.id = any (a.sites))
  where a.clos_at is null and now() > a.cree_at + make_interval(hours => delai_alerte(a.type))
    and not exists (select 1 from reponses_alerte r where r.alerte_id = a.id and r.site_id = s.id)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Documents du siège : lisibles par toutes les tablettes, déposés seulement par le siège.
create policy alertes_lire on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = 'alertes');
create policy alertes_envoyer on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = 'alertes' and public.est_siege());

revoke execute on function siege_creer_alerte(text, text, uuid, text, date, date, boolean, text, text, text, uuid[]),
  siege_clore_alerte(uuid), alertes_siege(), alertes_du_site(), relancer_alertes_produit() from public, anon;
revoke execute on function relancer_alertes_produit() from authenticated;
grant execute on function siege_creer_alerte(text, text, uuid, text, date, date, boolean, text, text, text, uuid[]),
  siege_clore_alerte(uuid), alertes_siege(), alertes_du_site() to authenticated;
