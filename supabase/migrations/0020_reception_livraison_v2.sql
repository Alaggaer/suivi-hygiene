-- Réception de livraison v2 : fournisseurs « viande » et jours de livraison habituels, BL sur plusieurs pages,
-- refus partiel (produits refusés), et verdict cohérent avec les températures (vérifié aussi par le serveur).
alter table fournisseurs add column viande boolean not null default false;
alter table fournisseurs add column jours_livraison smallint[];          -- 1 = lundi … 7 = dimanche ; vide = pas de jour fixe
alter table livraisons add column photos_bl_suite text[];               -- pages 2, 3… du bon de livraison
alter table livraisons add column produits_refuses text;

-- Une livraison hors température ne peut pas être enregistrée « conforme ».
create or replace function controler_vraisemblance() returns trigger
language plpgsql set search_path = public as $$
declare t numeric;
begin
  if tg_table_name = 'releves' then
    select e.t_max into t from enceintes e where e.id = new.enceinte_id;
    if t >= 0 and (new.valeur < -3 or new.valeur > 20) then
      raise exception 'Température impossible pour une enceinte positive (entre −3 et +20 °C) : %', new.valeur using errcode = '22023';
    elsif t < 0 and (new.valeur < -40 or new.valeur > 15) then
      raise exception 'Température impossible pour une enceinte négative (entre −40 et +15 °C) : %', new.valeur using errcode = '22023';
    end if;
  elsif tg_table_name = 'huiles' then
    if new.polaires is not null and (new.polaires < 0 or new.polaires > 40) then
      raise exception 'Mesure d''huile impossible (entre 0 et 40 %%) : %', new.polaires using errcode = '22023';
    end if;
  elsif tg_table_name = 'livraisons' then
    if new.t_camion < -30 or new.t_camion > 25 or new.t_frais < -5 or new.t_frais > 25 or new.t_surgele < -40 or new.t_surgele > 5 then
      raise exception 'Température de livraison impossible' using errcode = '22023';
    end if;
    if new.conforme and (new.t_camion > 4 or new.t_frais > 4 or new.t_surgele > -18) then
      raise exception 'Livraison hors température : elle ne peut pas être conforme' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

-- Preuves : toutes les pages du BL et les produits refusés.
create or replace function preuves_jour(p_site uuid, p_jour date)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare d timestamptz := (p_jour::timestamp at time zone 'Europe/Paris'); f timestamptz := ((p_jour + 1)::timestamp at time zone 'Europe/Paris');
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return jsonb_build_object(
    'taches', coalesce((select jsonb_agg(jsonb_build_object('titre', t.titre, 'echeance', t.echeance, 'faite_at', t.faite_at, 'par', p.nom) order by t.echeance)
      from taches t left join profils p on p.id = t.faite_par where t.site_id = p_site and t.jour = p_jour), '[]'),
    'releves', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'enceinte', e.nom, 'valeur', r.valeur, 't_max', r.t_max, 'conforme', r.conforme, 'action', r.action,
        'par', p.nom, 'at', heure_effective(r.at, r.at_client), 'recu_at', r.at, 'correction', correction_de('releves', r.id), 'rattrapage', r.rattrapage_motif) order by heure_effective(r.at, r.at_client), e.ordre)
      from releves r join enceintes e on e.id = r.enceinte_id join profils p on p.id = r.par where r.site_id = p_site and heure_effective(r.at, r.at_client) >= d and heure_effective(r.at, r.at_client) < f), '[]'),
    'huiles', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'friteuse', fr.nom, 'polaires', h.polaires, 'filtrage', h.filtrage, 'changement', h.changement,
        'non_utilisee', h.non_utilisee, 'par', p.nom, 'at', heure_effective(h.at, h.at_client), 'recu_at', h.at, 'correction', correction_de('huiles', h.id), 'rattrapage', h.rattrapage_motif) order by heure_effective(h.at, h.at_client), fr.nom)
      from huiles h join friteuses fr on fr.id = h.friteuse_id join profils p on p.id = h.par where h.site_id = p_site and heure_effective(h.at, h.at_client) >= d and heure_effective(h.at, h.at_client) < f), '[]'),
    'livraisons', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'fournisseur', fo.nom, 't_camion', l.t_camion, 't_frais', l.t_frais, 't_surgele', l.t_surgele, 'conforme', l.conforme,
        'motifs', l.motifs, 'action', l.action, 'viande', l.viande, 'origine_ok', l.origine_ok, 'photo_bl', l.photo_bl, 'photos_bl_suite', coalesce(to_jsonb(l.photos_bl_suite), '[]'::jsonb), 'produits_refuses', l.produits_refuses, 'photo_nc', l.photo_nc, 'range_at', l.range_at,
        'par', p.nom, 'at', heure_effective(l.at, l.at_client), 'recu_at', l.at, 'correction', correction_de('livraisons', l.id)) order by heure_effective(l.at, l.at_client))
      from livraisons l join fournisseurs fo on fo.id = l.fournisseur_id join profils p on p.id = l.par where l.site_id = p_site and heure_effective(l.at, l.at_client) >= d and heure_effective(l.at, l.at_client) < f), '[]'),
    'produits', coalesce((select jsonb_agg(jsonb_build_object('famille', u.famille, 'service', u.service, 'photo', u.photo, 'par', p.nom, 'at', heure_effective(u.at, u.at_client), 'recu_at', u.at) order by heure_effective(u.at, u.at_client))
      from utilisations u join profils p on p.id = u.par where u.site_id = p_site and heure_effective(u.at, u.at_client) >= d and heure_effective(u.at, u.at_client) < f), '[]'),
    'anomalies', coalesce((select jsonb_agg(jsonb_build_object('titre', a.titre, 'gravite', a.gravite, 'statut', a.statut, 'at', a.cree_at) order by a.cree_at)
      from anomalies a where a.site_id = p_site and a.cree_at >= d and a.cree_at < f), '[]')
  );
end $$;
