-- Fonctionnement hors ligne (revue de code, lot 2).
-- 1. Heure réelle d'une saisie faite hors ligne : retenue jusqu'à 7 jours (un week-end sans réseau), au lieu de 24 h.
-- 2. Une opération rejouée qui ne trouve plus rien à faire le dit (au lieu de disparaître sans effet),
--    sauf si c'est déjà fait (renvoi après coupure) : rangement, tâche, retrait d'un document.
-- 3. Compteur d'huile et mesure du jour d'après l'heure réelle de la mesure, pas son heure d'arrivée.

/* ---------- 1. Heure réelle : 7 jours ---------- */
create or replace function heure_effective(p_at timestamptz, p_at_client timestamptz) returns timestamptz
language sql immutable set search_path = public as $$
  select case when p_at_client is not null and p_at_client <= p_at + interval '2 minutes' and p_at_client >= p_at - interval '7 days'
              then p_at_client else p_at end
$$;

/* ---------- 2. Opérations rejouées ---------- */
create or replace function marquer_rangee(p_livraison uuid, p_at_client timestamptz) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update livraisons
  set range_at = case when p_at_client between now() - interval '7 days' and now() then p_at_client else now() end
  where id = p_livraison and range_at is null and (est_siege() or site_id = mon_site());
  if not found and not exists (select 1 from livraisons where id = p_livraison and range_at is not null and (est_siege() or site_id = mon_site())) then
    raise exception 'Livraison introuvable : elle n''a peut-être pas encore été reçue par le serveur' using errcode = 'P0002';
  end if;
end $$;

create or replace function terminer_tache(p_tache uuid, p_profil uuid, p_at_client timestamptz default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_at timestamptz := now(); t taches;
begin
  if p_at_client is not null and p_at_client between now() - interval '7 days' and now() then
    v_at := p_at_client;   -- faite hors ligne : on retient l'heure réelle de la saisie
  end if;
  select * into t from taches where id = p_tache and (est_siege() or site_id = mon_site());
  if t.id is null then raise exception 'Tâche introuvable' using errcode = 'P0002'; end if;
  if t.faite_at is not null then return; end if;   -- déjà faite (renvoi, ou faite par quelqu'un d'autre)
  if not exists (select 1 from profils p where p.id = p_profil and p.actif
                 and (p.site_id = t.site_id or (p.site_id is null and est_siege()))) then
    raise exception 'Personne inconnue ou désactivée sur ce restaurant' using errcode = '42501';
  end if;
  update taches set faite_at = v_at, faite_at_client = p_at_client, faite_par = p_profil where id = p_tache and faite_at is null;
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
  if a.statut = p_statut or (a.statut = 'verifiee' and p_statut = 'traitee') then return; end if;   -- déjà fait (renvoi)
  if p_at_client between now() - interval '7 days' and now() then v_at := p_at_client; end if;
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

create or replace function archiver_document(p_id uuid, p_profil uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d documents_pms;
begin
  select * into d from documents_pms where id = p_id;
  if d.id is null then raise exception 'Document introuvable' using errcode = 'P0002'; end if;
  if not est_siege() then
    if d.site_id is null then raise exception 'Document du groupe : réservé au siège' using errcode = '42501'; end if;
    perform auteur_pms(d.site_id, p_profil);
  end if;
  if not d.actif then return; end if;   -- déjà retiré (renvoi après coupure)
  update documents_pms set actif = false, archive_at = now() where id = p_id;
end $$;

-- Une action prévue hors ligne peut arriver après son échéance de quelques jours : on accepte jusqu'à 7 jours en arrière.
create or replace function planifier_action(p_anomalie uuid, p_profil uuid, p_action text, p_echeance date, p_responsable uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare a anomalies; r role_utilisateur;
begin
  select * into a from anomalies where id = p_anomalie and (est_siege() or site_id = mon_site());
  if not found then raise exception 'Anomalie introuvable' using errcode = 'P0002'; end if;
  if est_siege() then r := 'siege';
  else select role into r from profils where id = p_profil and actif and site_id = a.site_id; end if;
  if r is null or r = 'equipe' then raise exception 'Réservé au chef, au responsable ou au siège' using errcode = '42501'; end if;
  if a.statut = 'verifiee' then return; end if;   -- déjà close : rien à prévoir
  if length(trim(coalesce(p_action, ''))) < 3 then raise exception 'Décrivez l''action prévue' using errcode = '22023'; end if;
  if p_echeance is null or p_echeance < (now() at time zone 'Europe/Paris')::date - 7 then raise exception 'Échéance invalide' using errcode = '22023'; end if;
  if p_responsable is not null and not exists (select 1 from profils where id = p_responsable and actif and (site_id = a.site_id or site_id is null)) then
    raise exception 'Responsable inconnu sur ce site' using errcode = '22023';
  end if;
  update anomalies set action_prevue = trim(p_action), echeance = p_echeance, responsable_id = p_responsable,
    echeance_relancee = case when p_echeance is distinct from a.echeance then false else echeance_relancee end
  where id = a.id;
end $$;

/* ---------- 3. Huile : d'après l'heure réelle de la mesure ---------- */
create or replace function etat_friteuses()
returns table (friteuse_id uuid, jours_utilisation int, dernier_changement timestamptz,
               aujourd_hui_at timestamptz, aujourd_hui_polaires numeric, aujourd_hui_non_utilisee boolean)
language sql stable security invoker set search_path = public as $$
  with f as (select id from friteuses where actif and (site_id = mon_site() or est_siege())),
  h as (select x.friteuse_id, heure_effective(x.at, x.at_client) at, x.polaires, x.non_utilisee, x.changement
        from huiles x join f on f.id = x.friteuse_id),
  chg as (select h.friteuse_id, max(h.at) at from h where h.changement group by 1),
  jour as (
    select distinct on (h.friteuse_id) h.friteuse_id, h.at, h.polaires, h.non_utilisee
    from h
    where (h.at at time zone 'Europe/Paris')::date = (now() at time zone 'Europe/Paris')::date
    order by h.friteuse_id, h.at desc
  )
  select f.id,
    (select count(distinct (h.at at time zone 'Europe/Paris')::date)::int from h
      where h.friteuse_id = f.id and not h.non_utilisee and h.at >= coalesce(chg.at, '-infinity')),
    chg.at, jour.at, jour.polaires, jour.non_utilisee
  from f left join chg on chg.friteuse_id = f.id left join jour on jour.friteuse_id = f.id
$$;
