-- Siège v2 : anomalies du groupe (traiter / vérifier depuis le siège), preuves par restaurant et par jour,
-- compteur « à vérifier » et huile trop vieille dans le tableau.

-- 1. Le siège agit sous un profil à son nom (traçabilité de qui a vérifié), créé à la première action.
alter table profils add column auth_id uuid unique;

create or replace function profil_siege() returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v uuid; v_nom text;
begin
  if not est_siege() or auth.uid() is null then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  select id into v from profils where auth_id = auth.uid();
  if v is not null then return v; end if;
  select 'Siège (' || split_part(email, '@', 1) || ')' into v_nom from auth.users where id = auth.uid();
  insert into profils (site_id, nom, role, pin_hash, auth_id)
  values (null, coalesce(v_nom, 'Siège'), 'siege', crypt(gen_random_uuid()::text, gen_salt('bf')), auth.uid())
  returning id into v;
  return v;
end $$;

create or replace function siege_changer_statut(p_anomalie uuid, p_statut statut_anomalie, p_commentaire text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  perform changer_statut_anomalie(p_anomalie, p_statut, profil_siege(), p_commentaire, now());
end $$;

-- 2. Anomalies de tout le groupe : non vérifiées + vérifiées des 7 derniers jours.
create or replace function anomalies_siege()
returns table (id uuid, site_id uuid, restaurant text, titre text, categorie text, gravite gravite, statut statut_anomalie,
               cree_at timestamptz, cree_par text, traitee_at timestamptz, traitee_par text, traitee_commentaire text,
               verifiee_at timestamptz, verifiee_par text, photo text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return query
  select a.id, a.site_id, s.nom, a.titre, a.categorie, a.gravite, a.statut,
         a.cree_at, pc.nom, a.traitee_at, pt.nom, a.traitee_commentaire, a.verifiee_at, pv.nom, a.photo
  from anomalies a join sites s on s.id = a.site_id
  left join profils pc on pc.id = a.cree_par left join profils pt on pt.id = a.traitee_par left join profils pv on pv.id = a.verifiee_par
  where a.statut <> 'verifiee' or a.verifiee_at >= now() - interval '7 days'
  order by (a.statut = 'verifiee'), (a.gravite = 'critique') desc, a.cree_at;
end $$;

-- 3. Preuves d'un restaurant pour un jour (heure de Paris) : tout ce qu'on montre lors d'un contrôle.
create or replace function preuves_jour(p_site uuid, p_jour date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare d timestamptz := (p_jour::timestamp at time zone 'Europe/Paris'); f timestamptz := ((p_jour + 1)::timestamp at time zone 'Europe/Paris');
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return jsonb_build_object(
    'taches', coalesce((select jsonb_agg(jsonb_build_object('titre', t.titre, 'echeance', t.echeance, 'faite_at', t.faite_at, 'par', p.nom) order by t.echeance)
      from taches t left join profils p on p.id = t.faite_par where t.site_id = p_site and t.jour = p_jour), '[]'),
    'releves', coalesce((select jsonb_agg(jsonb_build_object('enceinte', e.nom, 'valeur', r.valeur, 't_max', r.t_max, 'conforme', r.conforme, 'action', r.action, 'par', p.nom, 'at', r.at) order by r.at, e.ordre)
      from releves r join enceintes e on e.id = r.enceinte_id join profils p on p.id = r.par where r.site_id = p_site and r.at >= d and r.at < f), '[]'),
    'huiles', coalesce((select jsonb_agg(jsonb_build_object('friteuse', fr.nom, 'polaires', h.polaires, 'filtrage', h.filtrage, 'changement', h.changement, 'non_utilisee', h.non_utilisee, 'par', p.nom, 'at', h.at) order by h.at, fr.nom)
      from huiles h join friteuses fr on fr.id = h.friteuse_id join profils p on p.id = h.par where h.site_id = p_site and h.at >= d and h.at < f), '[]'),
    'livraisons', coalesce((select jsonb_agg(jsonb_build_object('fournisseur', fo.nom, 't_camion', l.t_camion, 't_frais', l.t_frais, 't_surgele', l.t_surgele, 'conforme', l.conforme,
        'motifs', l.motifs, 'action', l.action, 'viande', l.viande, 'origine_ok', l.origine_ok, 'photo_bl', l.photo_bl, 'photo_nc', l.photo_nc, 'range_at', l.range_at, 'par', p.nom, 'at', l.at) order by l.at)
      from livraisons l join fournisseurs fo on fo.id = l.fournisseur_id join profils p on p.id = l.par where l.site_id = p_site and l.at >= d and l.at < f), '[]'),
    'produits', coalesce((select jsonb_agg(jsonb_build_object('famille', u.famille, 'service', u.service, 'photo', u.photo, 'par', p.nom, 'at', u.at) order by u.at)
      from utilisations u join profils p on p.id = u.par where u.site_id = p_site and u.at >= d and u.at < f), '[]'),
    'anomalies', coalesce((select jsonb_agg(jsonb_build_object('titre', a.titre, 'gravite', a.gravite, 'statut', a.statut, 'at', a.cree_at) order by a.cree_at)
      from anomalies a where a.site_id = p_site and a.cree_at >= d and a.cree_at < f), '[]')
  );
end $$;

-- 4. Tableau : « ouvertes » = pas encore traitées, « à vérifier » = traitées en attente du chef / siège ;
--    huile trop vieille = friteuses dont l'huile en place a servi plus de jours que le maximum.
-- Nouvelle fonction à côté de l'ancienne (pas de suppression) : l'app appelle désormais tableau_siege_v2.
create function tableau_siege_v2(p_jours integer default 7)
returns table (site_id uuid, nom text, ville text, taches_total int, taches_a_lheure int, taches_non_faites int,
               anomalies_ouvertes int, anomalies_a_verifier int, anomalies_critiques int, plus_ancienne_h int,
               livraisons int, livraisons_nc int, huile_mesures int, huile_rouges int, huile_max numeric, huile_trop_vieille int)
language plpgsql stable security definer set search_path = public, extensions as $$
declare debut date := (now() at time zone 'Europe/Paris')::date - (p_jours - 1);
        debut_ts timestamptz := (debut::timestamp at time zone 'Europe/Paris');
        rouge numeric := (select (valeur->>'rouge')::numeric from reglages where cle = 'huile');
        jmax int := coalesce((select (valeur->>'jours_max')::int from reglages where cle = 'huile'), 14);
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return query
  select s.id, s.nom, s.ville,
    (select count(*)::int from taches t where t.site_id = s.id and t.jour >= debut and t.echeance <= now()),
    (select count(*)::int from taches t where t.site_id = s.id and t.jour >= debut and t.faite_at <= t.echeance),
    (select count(*)::int from taches t where t.site_id = s.id and t.jour >= debut and t.echeance <= now() and t.faite_at is null),
    (select count(*)::int from anomalies a where a.site_id = s.id and a.statut = 'ouverte'),
    (select count(*)::int from anomalies a where a.site_id = s.id and a.statut = 'traitee'),
    (select count(*)::int from anomalies a where a.site_id = s.id and a.statut <> 'verifiee' and a.gravite = 'critique'),
    (select (extract(epoch from now() - min(a.cree_at)) / 3600)::int from anomalies a where a.site_id = s.id and a.statut <> 'verifiee'),
    (select count(*)::int from livraisons l where l.site_id = s.id and l.at >= debut_ts),
    (select count(*)::int from livraisons l where l.site_id = s.id and l.at >= debut_ts and not l.conforme),
    (select count(*)::int from huiles h where h.site_id = s.id and h.at >= debut_ts and h.polaires is not null),
    (select count(*)::int from huiles h where h.site_id = s.id and h.at >= debut_ts and h.polaires >= rouge),
    (select max(h.polaires) from huiles h where h.site_id = s.id and h.at >= debut_ts),
    (select count(*)::int from friteuses fr where fr.site_id = s.id and fr.actif and
      (select count(distinct (h.at at time zone 'Europe/Paris')::date) from huiles h
        where h.friteuse_id = fr.id and not h.non_utilisee
          and h.at >= coalesce((select max(h2.at) from huiles h2 where h2.friteuse_id = fr.id and h2.changement), '-infinity')) > jmax)
  from sites s where s.actif
  order by s.nom;
end $$;

revoke execute on function profil_siege(), siege_changer_statut(uuid, statut_anomalie, text), anomalies_siege(),
  preuves_jour(uuid, date), tableau_siege_v2(integer) from public, anon;
grant execute on function siege_changer_statut(uuid, statut_anomalie, text), anomalies_siege(),
  preuves_jour(uuid, date), tableau_siege_v2(integer) to authenticated;
