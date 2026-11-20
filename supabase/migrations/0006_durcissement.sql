-- Revue de sécurité : ce que la base garantit elle-même, quoi que fasse l'app.

-- 1. Les saisies ne se modifient plus directement depuis une tablette : seules les fonctions prévues
--    (terminer_tache, marquer_rangee, changer_statut_anomalie) peuvent changer une ligne existante.
do $$
declare t text;
begin
  foreach t in array array['taches','releves','huiles','livraisons','utilisations','minuteurs','anomalies'] loop
    execute format('drop policy modifier on %I', t);
    execute format('create policy modifier on %I for update using (est_siege())', t);
  end loop;
  -- Référentiels et tâches : écrits par le siège (et par generer_taches), pas par les tablettes.
  foreach t in array array['enceintes','friteuses','taches_modeles','taches'] loop
    execute format('drop policy ecrire on %I', t);
    execute format('create policy ecrire on %I for insert with check (est_siege())', t);
    execute format('drop policy modifier on %I', t);
    execute format('create policy modifier on %I for update using (est_siege())', t);
  end loop;
end $$;

-- 2. À l'insertion d'une saisie : la personne doit appartenir au site, et les valeurs de référence viennent du serveur.
create function controler_saisie() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_par uuid;
begin
  v_par := (to_jsonb(new) ->> case tg_table_name when 'anomalies' then 'cree_par' else 'par' end)::uuid;
  if v_par is not null and not exists (select 1 from profils p where p.id = v_par and (p.site_id = new.site_id or p.site_id is null)) then
    raise exception 'Cette personne n''appartient pas à ce restaurant' using errcode = '42501';
  end if;
  if tg_table_name = 'releves' then
    -- Le seuil est celui de l'enceinte, pas celui envoyé par la tablette.
    select e.t_max into new.t_max from enceintes e where e.id = new.enceinte_id and e.site_id = new.site_id;
    if new.t_max is null then raise exception 'Enceinte inconnue pour ce restaurant' using errcode = '23503'; end if;
  elsif tg_table_name = 'huiles' then
    if not exists (select 1 from friteuses f where f.id = new.friteuse_id and f.site_id = new.site_id) then
      raise exception 'Friteuse inconnue pour ce restaurant' using errcode = '23503';
    end if;
  elsif tg_table_name = 'anomalies' and not est_siege() then
    -- Une anomalie naît toujours « ouverte ».
    new.statut := 'ouverte'; new.escalade := 0; new.cree_at := now();
    new.traitee_par := null; new.traitee_at := null; new.traitee_commentaire := null;
    new.verifiee_par := null; new.verifiee_at := null;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['releves','huiles','livraisons','utilisations','minuteurs','anomalies'] loop
    execute format('create trigger %I_controle before insert on %I for each row execute function controler_saisie()', t, t);
  end loop;
end $$;

-- 3. PIN : 5 essais faux → personne bloquée 5 minutes (un PIN à 4 chiffres se devine sinon en quelques minutes).
create table pin_essais (
  profil_id uuid primary key references profils(id),
  echecs int not null default 0,
  bloque_jusqua timestamptz
);
alter table pin_essais enable row level security;   -- aucune politique : lisible seulement par les fonctions

drop function verifier_pin(uuid, text);
create function verifier_pin(p_profil uuid, p_pin text) returns boolean
language plpgsql volatile security definer set search_path = public, extensions as $$
declare ok boolean; e pin_essais;
begin
  if not exists (select 1 from profils p where p.id = p_profil and p.actif and (p.site_id = mon_site() or est_siege())) then
    return false;
  end if;
  select * into e from pin_essais where profil_id = p_profil;
  if e.bloque_jusqua is not null and e.bloque_jusqua > now() then
    raise exception 'Trop d''essais : réessayez dans quelques minutes' using errcode = 'P0001';
  end if;
  select p.pin_hash = crypt(p_pin, p.pin_hash) into ok from profils p where p.id = p_profil;
  if ok then
    delete from pin_essais where profil_id = p_profil;
  else
    insert into pin_essais (profil_id, echecs) values (p_profil, 1)
    on conflict (profil_id) do update set
      echecs = case when pin_essais.bloque_jusqua is not null and pin_essais.bloque_jusqua <= now() then 1 else pin_essais.echecs + 1 end,
      bloque_jusqua = case when (case when pin_essais.bloque_jusqua is not null and pin_essais.bloque_jusqua <= now() then 1 else pin_essais.echecs + 1 end) >= 5
                           then now() + interval '5 minutes' else null end;
  end if;
  return ok;
end $$;

-- 4. Le journal des modifications contient les lignes de tous les sites : lisible par le siège seulement.
alter table journal enable row level security;
create policy lire on journal for select using (est_siege());
