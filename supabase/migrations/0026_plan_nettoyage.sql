-- Plan de nettoyage et de désinfection (PND), géré par le siège pour tout le groupe.
-- Chaque jour, les éléments à nettoyer deviennent une tâche par zone et par heure (« Nettoyage cuisine · 6 éléments »).
-- L'équipe coche chaque élément (photo quand elle est demandée) ; la tâche se termine quand tout est fait.
-- Fiches techniques (FT) et de sécurité (FDS) des produits d'entretien : déposées par le siège, lisibles sur la tablette.

create table produits_entretien (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(trim(nom)) >= 2),
  usage text,                 -- ex. « Surfaces en contact alimentaire »
  dilution text,              -- ex. « 2 % : 20 mL pour 1 L d'eau »
  temps_contact text,         -- ex. « 5 min »
  ft text,                    -- chemin du PDF dans le stockage (documents/…)
  fds text,
  actif boolean not null default true,
  cree_at timestamptz not null default now()
);
alter table produits_entretien enable row level security;
create policy lire on produits_entretien for select to authenticated using (true);
create policy gerer on produits_entretien for all to authenticated using (est_siege()) with check (est_siege());

create table nettoyage_elements (
  id uuid primary key default gen_random_uuid(),
  zone text not null check (length(trim(zone)) >= 2),
  element text not null check (length(trim(element)) >= 2),
  frequence text not null check (frequence in ('jour', 'semaine', 'mois')),
  jour smallint,              -- semaine : 1 (lundi) à 7 ; mois : 1 à 28
  heure_limite time not null default '23:30',
  produit_id uuid references produits_entretien(id),
  methode text,
  photo_obligatoire boolean not null default false,
  sites uuid[],               -- null : tous les restaurants
  ordre int not null default 0,
  actif boolean not null default true,
  constraint jour_coherent check (
    (frequence = 'jour' and jour is null) or (frequence = 'semaine' and jour between 1 and 7) or (frequence = 'mois' and jour between 1 and 28))
);
alter table nettoyage_elements enable row level security;
create policy lire on nettoyage_elements for select to authenticated using (est_siege() or sites is null or mon_site() = any (sites));
create policy gerer on nettoyage_elements for all to authenticated using (est_siege()) with check (est_siege());

-- Une tâche de nettoyage = une zone à une heure, avec la liste des éléments prévus ce jour-là.
alter table taches add column zone text, add column elements uuid[];
create unique index taches_nettoyage_unique on taches (site_id, jour, zone, echeance) where zone is not null;

create table nettoyages_faits (
  id uuid primary key,        -- id créé par la tablette (renvoi sans doublon)
  site_id uuid not null references sites(id),
  tache_id uuid not null references taches(id),
  element_id uuid not null references nettoyage_elements(id),
  photo text,
  par uuid not null references profils(id),
  at timestamptz not null default now(),
  at_client timestamptz
);
create index on nettoyages_faits (tache_id);
alter table nettoyages_faits enable row level security;
create policy lire on nettoyages_faits for select using (est_siege() or site_id = mon_site());
create policy ecrire on nettoyages_faits for insert with check (site_id = mon_site());
create trigger controle before insert on nettoyages_faits for each row execute function controler_saisie();

-- L'élément doit faire partie de la tâche ; photo exigée si le plan la demande ; tâche terminée quand tout est coché.
create or replace function controler_nettoyage() returns trigger
language plpgsql security definer set search_path = public as $$
declare t taches;
begin
  select * into t from taches where id = new.tache_id;
  if t.id is null or t.site_id <> new.site_id or not new.element_id = any (coalesce(t.elements, '{}')) then
    raise exception 'Cet élément ne fait pas partie de cette tâche de nettoyage' using errcode = '23503';
  end if;
  if new.photo is null and (select photo_obligatoire from nettoyage_elements where id = new.element_id) then
    raise exception 'Photo obligatoire pour cet élément' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger controle_nettoyage before insert on nettoyages_faits for each row execute function controler_nettoyage();

create or replace function terminer_nettoyage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update taches t set faite_at = heure_effective(new.at, new.at_client), faite_at_client = new.at_client, faite_par = new.par
  where t.id = new.tache_id and t.faite_at is null
    and not exists (select 1 from unnest(t.elements) e
                    where not exists (select 1 from nettoyages_faits f where f.tache_id = t.id and f.element_id = e));
  return null;
end $$;
create trigger terminer after insert on nettoyages_faits for each row execute function terminer_nettoyage();

-- Éléments prévus un jour donné pour un restaurant.
create or replace function nettoyage_prevu(p_site uuid, p_jour date) returns setof nettoyage_elements
language sql stable set search_path = public as $$
  select e.* from nettoyage_elements e
  where e.actif and (e.sites is null or p_site = any (e.sites))
    and (e.frequence = 'jour'
      or (e.frequence = 'semaine' and e.jour = extract(isodow from p_jour))
      or (e.frequence = 'mois' and e.jour = extract(day from p_jour)))
$$;

-- Tâches de nettoyage du jour : une par zone et par heure.
create or replace function generer_nettoyages(p_jour date, p_apres timestamptz default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into taches (site_id, type, titre, jour, echeance, zone, elements)
  select s.id, 'nettoyage', 'Nettoyage ' || lower(e.zone), p_jour, (p_jour + e.heure_limite) at time zone 'Europe/Paris', e.zone,
         array_agg(e.id order by e.ordre, e.element)
  from sites s cross join lateral nettoyage_prevu(s.id, p_jour) e
  where s.actif and (p_apres is null or (p_jour + e.heure_limite) at time zone 'Europe/Paris' > p_apres)
  group by s.id, e.zone, e.heure_limite
  on conflict (site_id, jour, zone, echeance) where zone is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- La génération de chaque nuit crée aussi les tâches de nettoyage.
create or replace function generer_taches(p_jour date default (now() at time zone 'Europe/Paris')::date)
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
  return n + generer_nettoyages(p_jour);
end $$;

-- Tablette : détail d'une tâche de nettoyage (éléments, produit, ce qui est déjà fait).
create or replace function nettoyage_tache(p_tache uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'zone', e.zone, 'element', e.element, 'methode', e.methode, 'photo_obligatoire', e.photo_obligatoire,
    'produit', case when p.id is null then null else jsonb_build_object('id', p.id, 'nom', p.nom, 'dilution', p.dilution,
                 'temps_contact', p.temps_contact, 'ft', p.ft, 'fds', p.fds) end,
    'fait', (select jsonb_build_object('par', pr.nom, 'at', heure_effective(f.at, f.at_client), 'photo', f.photo)
             from nettoyages_faits f left join profils pr on pr.id = f.par
             where f.tache_id = t.id and f.element_id = e.id order by f.at limit 1)
  ) order by x.n), '[]'::jsonb)
  from taches t
  cross join lateral unnest(t.elements) with ordinality x(id, n)
  join nettoyage_elements e on e.id = x.id
  left join produits_entretien p on p.id = e.produit_id
  where t.id = p_tache and (est_siege() or t.site_id = mon_site())
$$;

-- Tablette : toutes les tâches de nettoyage du jour avec leurs éléments (une seule lecture, gardée hors ligne).
create or replace function nettoyage_du_jour() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tache_id', t.id, 'zone', t.zone, 'echeance', t.echeance, 'elements', nettoyage_tache(t.id))
    order by t.echeance, t.zone), '[]'::jsonb)
  from taches t
  where t.zone is not null and t.site_id = mon_site() and t.jour = (now() at time zone 'Europe/Paris')::date
$$;

-- Siège : réalisation par restaurant et par zone sur une journée, avec les preuves.
create or replace function nettoyage_siege(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('site_id', s.id, 'restaurant', s.nom, 'taches', (
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'zone', t.zone, 'echeance', t.echeance, 'faite_at', t.faite_at,
        'total', cardinality(t.elements),
        'faits', (select count(distinct f.element_id) from nettoyages_faits f where f.tache_id = t.id),
        'photos', (select coalesce(jsonb_agg(jsonb_build_object('element', e.element, 'photo', f.photo, 'par', pr.nom,
                     'at', heure_effective(f.at, f.at_client)) order by f.at), '[]'::jsonb)
                   from nettoyages_faits f join nettoyage_elements e on e.id = f.element_id left join profils pr on pr.id = f.par
                   where f.tache_id = t.id and f.photo is not null)
      ) order by t.echeance, t.zone), '[]'::jsonb)
      from taches t where t.site_id = s.id and t.jour = p_jour and t.zone is not null)) order by s.nom)
    from sites s where s.actif), '[]'::jsonb);
end $$;

-- Le modèle « Nettoyage hottes et filtres » est remplacé par le plan de nettoyage.
update taches_modeles set actif = false where type = 'nettoyage' and titre = 'Nettoyage hottes et filtres' and actif;
create or replace function siege_creer_restaurant(p_nom text, p_ville text, p_ouverture time default '09:00', p_service_soir time default '18:45')
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  if p_nom is null or length(trim(p_nom)) < 2 or p_ville is null or length(trim(p_ville)) < 2 then
    raise exception 'Nom et ville obligatoires' using errcode = '22023';
  end if;
  if exists (select 1 from sites where upper(nom) = upper(trim(p_nom))) then raise exception 'Un restaurant porte déjà ce nom' using errcode = '22023'; end if;
  insert into sites (nom, ville, ouverture, service_soir) values (upper(trim(p_nom)), upper(trim(p_ville)), p_ouverture, p_service_soir) returning id into v;
  insert into taches_modeles (site_id, type, titre, heure_limite, jours) values
    (v, 'releves', 'Relevé températures du matin', '11:00', '{1,2,3,4,5,6,7}'),
    (v, 'huile', 'Mesure de l''huile', '11:30', '{1,2,3,4,5,6,7}'),
    (v, 'releves', 'Relevé températures du soir', '18:00', '{1,2,3,4,5,6,7}'),
    (v, 'dlc', 'Tour des DLC', '10:30', '{1}');
  return v;
end $$;

-- Fiches FT/FDS : lisibles par toutes les tablettes, déposées seulement par le siège.
create policy documents_lire on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = 'documents');
create policy documents_envoyer on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = 'documents' and public.est_siege());

revoke execute on function controler_nettoyage(), terminer_nettoyage(), generer_nettoyages(date, timestamptz), nettoyage_prevu(uuid, date) from public, anon, authenticated;
revoke execute on function nettoyage_tache(uuid), nettoyage_du_jour(), nettoyage_siege(date) from public, anon;
grant execute on function nettoyage_tache(uuid), nettoyage_du_jour(), nettoyage_siege(date) to authenticated;

-- Plan type de départ, à corriger par le siège (produits génériques, sans marque).
with p as (
  insert into produits_entretien (nom, usage, dilution, temps_contact) values
    ('Détergent désinfectant surfaces', 'Plans de travail, ustensiles, frigos (contact alimentaire)', 'Prêt à l''emploi', '5 min'),
    ('Dégraissant cuisine', 'Hotte, filtres, plaques, friteuses (extérieur)', '5 % : 50 mL pour 1 L', '10 min'),
    ('Détergent désinfectant sols', 'Sols cuisine, plonge, réserve, salle', '1 % : 10 mL pour 1 L', '5 min'),
    ('Désinfectant sanitaires', 'Toilettes, lavabos, poignées', 'Prêt à l''emploi', '5 min'),
    ('Détartrant lave-vaisselle', 'Détartrage du lave-vaisselle', 'Selon la notice du lave-vaisselle', null),
    ('Nettoyant vitres', 'Vitres, portes vitrées', 'Prêt à l''emploi', null)
  returning id, nom
), plan (zone, element, frequence, jour, heure, produit, methode, photo, ordre) as (values
  ('Cuisine', 'Plans de travail et surfaces', 'jour', null::smallint, '15:30'::time, 'Détergent désinfectant surfaces', 'Débarrasser, pulvériser, laisser agir, rincer, essuyer à usage unique', false, 1),
  ('Cuisine', 'Plans de travail et surfaces', 'jour', null, '23:30', 'Détergent désinfectant surfaces', 'Débarrasser, pulvériser, laisser agir, rincer, essuyer à usage unique', false, 1),
  ('Cuisine', 'Plaque de cuisson et grill', 'jour', null, '23:30', 'Dégraissant cuisine', 'Racler à chaud, dégraisser à froid, rincer', true, 2),
  ('Cuisine', 'Friteuses (extérieur et pourtour)', 'jour', null, '23:30', 'Dégraissant cuisine', null, false, 3),
  ('Cuisine', 'Poignées, interrupteurs, portes de frigos', 'jour', null, '23:30', 'Détergent désinfectant surfaces', null, false, 4),
  ('Cuisine', 'Poubelles (vidage et désinfection)', 'jour', null, '23:30', 'Détergent désinfectant surfaces', null, false, 5),
  ('Cuisine', 'Sol de la cuisine', 'jour', null, '23:30', 'Détergent désinfectant sols', 'Balayer, laver, laisser agir, raclette', true, 6),
  ('Cuisine', 'Hotte et filtres', 'semaine', 5, '23:30', 'Dégraissant cuisine', 'Filtres démontés, trempage, rinçage, séchage', true, 7),
  ('Cuisine', 'Intérieur des frigos et chambres froides', 'semaine', 1, '15:30', 'Détergent désinfectant surfaces', 'Vider, nettoyer, rincer, sécher, contrôler les DLC en rangeant', true, 8),
  ('Cuisine', 'Murs et faïences', 'semaine', 3, '23:30', 'Détergent désinfectant surfaces', null, false, 9),
  ('Cuisine', 'Grilles et bouches d''aération', 'mois', 1, '15:30', 'Dégraissant cuisine', null, true, 10),
  ('Cuisine', 'Dégivrage des congélateurs', 'mois', 15, '15:30', 'Détergent désinfectant surfaces', 'Transférer les produits au froid, dégivrer, nettoyer, sécher', true, 11),
  ('Plonge', 'Bacs de plonge et égouttoirs', 'jour', null, '23:30', 'Détergent désinfectant surfaces', null, false, 1),
  ('Plonge', 'Lave-vaisselle : vidange et filtres', 'jour', null, '23:30', null, 'Vidanger, rincer les filtres, laisser la porte ouverte', true, 2),
  ('Plonge', 'Sol de la plonge', 'jour', null, '23:30', 'Détergent désinfectant sols', null, false, 3),
  ('Plonge', 'Détartrage du lave-vaisselle', 'semaine', 7, '23:30', 'Détartrant lave-vaisselle', null, false, 4),
  ('Réserve', 'Étagères et sol de la réserve', 'semaine', 2, '15:30', 'Détergent désinfectant sols', 'Rien posé au sol, premier entré premier sorti', true, 1),
  ('Salle', 'Tables, chaises et banquettes', 'jour', null, '23:30', 'Détergent désinfectant surfaces', null, false, 1),
  ('Salle', 'Sol de la salle', 'jour', null, '23:30', 'Détergent désinfectant sols', null, false, 2),
  ('Salle', 'Vitres et portes vitrées', 'mois', 1, '15:30', 'Nettoyant vitres', null, false, 3),
  ('Sanitaires', 'Sanitaires clients et personnel', 'jour', null, '15:30', 'Désinfectant sanitaires', null, false, 1),
  ('Sanitaires', 'Sanitaires clients et personnel', 'jour', null, '23:30', 'Désinfectant sanitaires', null, true, 1)
)
insert into nettoyage_elements (zone, element, frequence, jour, heure_limite, produit_id, methode, photo_obligatoire, ordre)
select plan.zone, plan.element, plan.frequence, plan.jour, plan.heure, p.id, plan.methode, plan.photo, plan.ordre
from plan left join p on p.nom = plan.produit;

-- Tâches de nettoyage d'aujourd'hui encore à venir (pas de tâche déjà « en retard » à la mise en place).
select generer_nettoyages((now() at time zone 'Europe/Paris')::date, now());
