-- Stocks morts : produits sortis de la carte et oubliés en réserve.
-- Le siège déclare un produit retiré (pour tout le groupe) ; chaque restaurant vérifie s'il lui en reste, et décide :
-- plus rien (soldé), jeté, transféré à un autre restaurant (soldé pour lui), ou à écouler (revérifié tous les 7 jours).
create table produits_retires (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(trim(nom)) >= 2),
  fournisseur_id uuid references fournisseurs(id),
  consigne text,
  sortie_le date not null default (now() at time zone 'Europe/Paris')::date,
  actif boolean not null default true,
  cree_par uuid not null references profils(id),
  cree_at timestamptz not null default now(),
  clos_at timestamptz
);
alter table produits_retires enable row level security;
create policy lire on produits_retires for select to authenticated using (true);
-- Écriture seulement par les fonctions du siège.

create table inventaires_stock (
  id uuid primary key,                                          -- id créé par la tablette (renvoi sans doublon)
  produit_id uuid not null references produits_retires(id),
  site_id uuid not null references sites(id),
  reste boolean not null,
  quantite text,
  dlc date,
  photo text,
  decision text check (decision in ('jete', 'transfere', 'a_ecouler')),
  transfert_vers text,
  par uuid not null references profils(id),
  at timestamptz not null default now(),
  at_client timestamptz,
  constraint reste_complet check (not reste or (quantite is not null and photo is not null and decision is not null)),
  constraint transfert_precise check (decision is distinct from 'transfere' or transfert_vers is not null)
);
create index on inventaires_stock (produit_id, site_id, at desc);
alter table inventaires_stock enable row level security;
create policy lire on inventaires_stock for select using (est_siege() or site_id = mon_site());
create policy ecrire on inventaires_stock for insert with check (site_id = mon_site());
create trigger controle before insert on inventaires_stock for each row execute function controler_saisie();

-- Soldé = plus rien, jeté ou transféré. « À écouler » reste ouvert et redemande une vérification après 7 jours ou à la DLC.
create or replace function etat_stock(p_reste boolean, p_decision text) returns text
language sql immutable as $$
  select case when p_reste is null then null when not p_reste or p_decision in ('jete', 'transfere') then 'solde' else 'a_ecouler' end
$$;

-- Tablette : les produits retirés encore actifs, et où en est ce restaurant pour chacun.
create or replace function stocks_morts_du_site()
returns table (produit_id uuid, nom text, fournisseur text, consigne text, sortie_le date,
               etat text, quantite text, dlc date, verifie_at timestamptz, a_faire boolean)
language sql stable security invoker set search_path = public as $$
  select p.id, p.nom, f.nom, p.consigne, p.sortie_le,
    coalesce(etat_stock(i.reste, i.decision), 'a_verifier'), i.quantite, i.dlc, i.at,
    i.id is null
      or (etat_stock(i.reste, i.decision) = 'a_ecouler'
          and (i.at < now() - interval '7 days' or i.dlc <= (now() at time zone 'Europe/Paris')::date))
  from produits_retires p
  left join fournisseurs f on f.id = p.fournisseur_id
  left join lateral (select * from inventaires_stock x where x.produit_id = p.id and x.site_id = mon_site() order by x.at desc limit 1) i on true
  where p.actif
  order by (i.id is null) desc, p.cree_at
$$;

-- Siège : déclarer, clore.
create or replace function siege_retirer_produit(p_nom text, p_fournisseur uuid default null, p_consigne text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v uuid;
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  if p_nom is null or length(trim(p_nom)) < 2 then raise exception 'Nom du produit obligatoire' using errcode = '22023'; end if;
  insert into produits_retires (nom, fournisseur_id, consigne, cree_par)
  values (trim(p_nom), p_fournisseur, nullif(trim(p_consigne), ''), profil_siege()) returning id into v;
  return v;
end $$;

create or replace function siege_clore_produit(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  update produits_retires set actif = false, clos_at = now() where id = p_id and actif;
end $$;

-- Siège : suivi par produit et par restaurant (dernière réponse de chaque restaurant actif).
create or replace function stocks_morts_siege()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'nom', p.nom, 'fournisseur', f.nom, 'consigne', p.consigne, 'sortie_le', p.sortie_le, 'actif', p.actif,
      'sites', (select jsonb_agg(jsonb_build_object(
          'site_id', s.id, 'restaurant', s.nom,
          'etat', coalesce(etat_stock(i.reste, i.decision), 'a_verifier'),
          'quantite', i.quantite, 'dlc', i.dlc, 'photo', i.photo, 'decision', i.decision, 'transfert_vers', i.transfert_vers,
          'par', pr.nom, 'at', i.at) order by s.nom)
        from sites s
        left join lateral (select * from inventaires_stock x where x.produit_id = p.id and x.site_id = s.id order by x.at desc limit 1) i on true
        left join profils pr on pr.id = i.par
        where s.actif)
    ) order by p.actif desc, p.cree_at desc)
    from produits_retires p left join fournisseurs f on f.id = p.fournisseur_id
    where p.actif or p.clos_at > now() - interval '30 days'), '[]'::jsonb);
end $$;

revoke execute on function siege_retirer_produit(text, uuid, text), siege_clore_produit(uuid), stocks_morts_siege(), stocks_morts_du_site() from public, anon;
grant execute on function siege_retirer_produit(text, uuid, text), siege_clore_produit(uuid), stocks_morts_siege(), stocks_morts_du_site() to authenticated;
