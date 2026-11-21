-- Saisie oubliée, rattrapée par le siège : un relevé ou une mesure d'huile ajouté après coup, à l'heure où il aurait dû être fait.
-- Toujours signalé comme tel (« saisi après coup par le siège », motif obligatoire) ; la tâche manquée reste manquée.
alter table releves add column rattrapage_motif text;
alter table huiles add column rattrapage_motif text;

create or replace function siege_rattraper(p_type text, p_equipement uuid, p_at timestamptz, p_valeur numeric, p_motif text,
                                           p_action text default null, p_decision text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_site uuid; v_tmax numeric; v_id uuid := gen_random_uuid(); v_rouge numeric;
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  if p_motif is null or length(trim(p_motif)) < 5 then raise exception 'Motif obligatoire (5 caractères au moins)' using errcode = '22023'; end if;
  if p_at is null or p_at > now() + interval '2 minutes' then raise exception 'L''heure de la saisie oubliée doit être passée' using errcode = '22023'; end if;
  if p_at < now() - interval '31 days' then raise exception 'Rattrapage limité aux 31 derniers jours' using errcode = '22023'; end if;
  if p_valeur is null then raise exception 'Valeur obligatoire' using errcode = '22023'; end if;
  if p_type = 'releve' then
    select e.site_id, e.t_max into v_site, v_tmax from enceintes e where e.id = p_equipement;
    if v_site is null then raise exception 'Enceinte inconnue' using errcode = '22023'; end if;
    if p_valeur > v_tmax and (p_action is null or length(trim(p_action)) = 0) then
      raise exception 'Hors seuil : l''action corrective faite à l''époque est obligatoire' using errcode = '22023';
    end if;
    insert into releves (id, site_id, enceinte_id, valeur, t_max, action, par, at, rattrapage_motif)
    values (v_id, v_site, p_equipement, p_valeur, v_tmax, nullif(trim(p_action), ''), profil_siege(), p_at, trim(p_motif));
  elsif p_type = 'huile' then
    select f.site_id into v_site from friteuses f where f.id = p_equipement;
    if v_site is null then raise exception 'Friteuse inconnue' using errcode = '22023'; end if;
    if p_decision not in ('filtree', 'changee') then raise exception 'Indiquez si l''huile a été filtrée ou changée' using errcode = '22023'; end if;
    v_rouge := (select (valeur->>'rouge')::numeric from reglages where cle = 'huile');
    if p_valeur >= v_rouge and p_decision <> 'changee' then
      raise exception 'Huile au-delà du seuil : seul « changée » est possible' using errcode = '22023';
    end if;
    insert into huiles (id, site_id, friteuse_id, polaires, filtrage, changement, par, at, rattrapage_motif)
    values (v_id, v_site, p_equipement, p_valeur, p_decision = 'filtree', p_decision = 'changee', profil_siege(), p_at, trim(p_motif));
  else
    raise exception 'Type de saisie non rattrapable : %', p_type using errcode = '22023';
  end if;
  return v_id;
end $$;

create or replace function preuves_jour(p_site uuid, p_jour date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare d timestamptz := (p_jour::timestamp at time zone 'Europe/Paris'); f timestamptz := ((p_jour + 1)::timestamp at time zone 'Europe/Paris');
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return jsonb_build_object(
    'taches', coalesce((select jsonb_agg(jsonb_build_object('titre', t.titre, 'echeance', t.echeance, 'faite_at', t.faite_at, 'par', p.nom) order by t.echeance)
      from taches t left join profils p on p.id = t.faite_par where t.site_id = p_site and t.jour = p_jour), '[]'),
    'releves', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'enceinte', e.nom, 'valeur', r.valeur, 't_max', r.t_max, 'conforme', r.conforme, 'action', r.action,
        'par', p.nom, 'at', r.at, 'correction', correction_de('releves', r.id), 'rattrapage', r.rattrapage_motif) order by r.at, e.ordre)
      from releves r join enceintes e on e.id = r.enceinte_id join profils p on p.id = r.par where r.site_id = p_site and r.at >= d and r.at < f), '[]'),
    'huiles', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'friteuse', fr.nom, 'polaires', h.polaires, 'filtrage', h.filtrage, 'changement', h.changement,
        'non_utilisee', h.non_utilisee, 'par', p.nom, 'at', h.at, 'correction', correction_de('huiles', h.id), 'rattrapage', h.rattrapage_motif) order by h.at, fr.nom)
      from huiles h join friteuses fr on fr.id = h.friteuse_id join profils p on p.id = h.par where h.site_id = p_site and h.at >= d and h.at < f), '[]'),
    'livraisons', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'fournisseur', fo.nom, 't_camion', l.t_camion, 't_frais', l.t_frais, 't_surgele', l.t_surgele, 'conforme', l.conforme,
        'motifs', l.motifs, 'action', l.action, 'viande', l.viande, 'origine_ok', l.origine_ok, 'photo_bl', l.photo_bl, 'photo_nc', l.photo_nc, 'range_at', l.range_at,
        'par', p.nom, 'at', l.at, 'correction', correction_de('livraisons', l.id)) order by l.at)
      from livraisons l join fournisseurs fo on fo.id = l.fournisseur_id join profils p on p.id = l.par where l.site_id = p_site and l.at >= d and l.at < f), '[]'),
    'produits', coalesce((select jsonb_agg(jsonb_build_object('famille', u.famille, 'service', u.service, 'photo', u.photo, 'par', p.nom, 'at', u.at) order by u.at)
      from utilisations u join profils p on p.id = u.par where u.site_id = p_site and u.at >= d and u.at < f), '[]'),
    'anomalies', coalesce((select jsonb_agg(jsonb_build_object('titre', a.titre, 'gravite', a.gravite, 'statut', a.statut, 'at', a.cree_at) order by a.cree_at)
      from anomalies a where a.site_id = p_site and a.cree_at >= d and a.cree_at < f), '[]')
  );
end $$;

revoke execute on function siege_rattraper(text, uuid, timestamptz, numeric, text, text, text) from public, anon;
grant execute on function siege_rattraper(text, uuid, timestamptz, numeric, text, text, text) to authenticated;
