-- Gestion par le siège, sans passer par la base : restaurants, employés et codes PIN.
-- (Enceintes, friteuses, tâches, fournisseurs : le siège les modifie directement, les règles d'accès le permettent déjà.)

-- Un PIN à 4 chiffres, tiré au hasard (pas 0000, pas 1234…).
create or replace function pin_aleatoire() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare p text;
begin
  loop
    p := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when p !~ '^(\d)\1{3}$' and p not in ('1234', '4321', '0123', '9876', '1111', '2580');
  end loop;
  return p;
end $$;

-- Employés d'un restaurant, sans leur PIN (jamais lisible).
create or replace function employes_site(p_site uuid)
returns table (id uuid, nom text, role role_utilisateur, actif boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return query select p.id, p.nom, p.role, p.actif from profils p where p.site_id = p_site order by p.actif desc, p.nom;
end $$;

-- Nouvel employé : renvoie son PIN, affiché une seule fois au siège.
create or replace function siege_ajouter_employe(p_site uuid, p_nom text, p_role role_utilisateur)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_pin text := pin_aleatoire();
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  if p_nom is null or length(trim(p_nom)) < 2 then raise exception 'Nom obligatoire' using errcode = '22023'; end if;
  if p_role = 'siege' then raise exception 'Un compte siège ne se crée pas ici' using errcode = '22023'; end if;
  if not exists (select 1 from sites where id = p_site) then raise exception 'Restaurant inconnu' using errcode = '22023'; end if;
  insert into profils (site_id, nom, role, pin_hash) values (p_site, trim(p_nom), p_role, crypt(v_pin, gen_salt('bf')));
  return v_pin;
end $$;

-- PIN oublié : un nouveau PIN, l'ancien ne marche plus.
create or replace function siege_nouveau_pin(p_profil uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_pin text := pin_aleatoire();
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  update profils set pin_hash = crypt(v_pin, gen_salt('bf')) where id = p_profil and site_id is not null;
  if not found then raise exception 'Employé inconnu' using errcode = '22023'; end if;
  delete from pin_essais where profil_id = p_profil;
  return v_pin;
end $$;

-- Changer le rôle ou désactiver (un employé n'est jamais supprimé : ses saisies restent signées de son nom).
create or replace function siege_modifier_employe(p_profil uuid, p_nom text, p_role role_utilisateur, p_actif boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  if p_role = 'siege' then raise exception 'Rôle non autorisé ici' using errcode = '22023'; end if;
  update profils set nom = coalesce(nullif(trim(p_nom), ''), nom), role = p_role, actif = p_actif where id = p_profil and site_id is not null;
  if not found then raise exception 'Employé inconnu' using errcode = '22023'; end if;
end $$;

-- Nouveau restaurant, avec les tâches du jour habituelles (modifiables ensuite).
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
    (v, 'dlc', 'Tour des DLC', '10:30', '{1}'),
    (v, 'nettoyage', 'Nettoyage hottes et filtres', '23:00', '{5}');
  return v;
end $$;

revoke execute on function pin_aleatoire() from public, anon, authenticated;
revoke execute on function employes_site(uuid), siege_ajouter_employe(uuid, text, role_utilisateur), siege_nouveau_pin(uuid),
  siege_modifier_employe(uuid, text, role_utilisateur, boolean), siege_creer_restaurant(text, text, time, time) from public, anon;
grant execute on function employes_site(uuid), siege_ajouter_employe(uuid, text, role_utilisateur), siege_nouveau_pin(uuid),
  siege_modifier_employe(uuid, text, role_utilisateur, boolean), siege_creer_restaurant(text, text, time, time) to authenticated;
