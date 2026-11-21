-- Heure réelle des saisies : une tablette hors ligne envoie plus tard, mais la saisie a été faite à l'heure de la tablette (at_client).
-- On l'accepte si elle est passée et date de moins de 24 h avant la réception (même règle que terminer_tache) ; sinon l'heure de réception.
create or replace function heure_effective(p_at timestamptz, p_at_client timestamptz) returns timestamptz
language sql immutable as $$
  select case when p_at_client is not null and p_at_client <= p_at + interval '2 minutes' and p_at_client >= p_at - interval '24 hours'
              then p_at_client else p_at end
$$;

-- Preuves : chaque saisie à son heure réelle (« at »), avec l'heure de réception (« recu_at ») ; le jour se choisit sur l'heure réelle.
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
        'motifs', l.motifs, 'action', l.action, 'viande', l.viande, 'origine_ok', l.origine_ok, 'photo_bl', l.photo_bl, 'photo_nc', l.photo_nc, 'range_at', l.range_at,
        'par', p.nom, 'at', heure_effective(l.at, l.at_client), 'recu_at', l.at, 'correction', correction_de('livraisons', l.id)) order by heure_effective(l.at, l.at_client))
      from livraisons l join fournisseurs fo on fo.id = l.fournisseur_id join profils p on p.id = l.par where l.site_id = p_site and heure_effective(l.at, l.at_client) >= d and heure_effective(l.at, l.at_client) < f), '[]'),
    'produits', coalesce((select jsonb_agg(jsonb_build_object('famille', u.famille, 'service', u.service, 'photo', u.photo, 'par', p.nom, 'at', heure_effective(u.at, u.at_client), 'recu_at', u.at) order by heure_effective(u.at, u.at_client))
      from utilisations u join profils p on p.id = u.par where u.site_id = p_site and heure_effective(u.at, u.at_client) >= d and heure_effective(u.at, u.at_client) < f), '[]'),
    'anomalies', coalesce((select jsonb_agg(jsonb_build_object('titre', a.titre, 'gravite', a.gravite, 'statut', a.statut, 'at', a.cree_at) order by a.cree_at)
      from anomalies a where a.site_id = p_site and a.cree_at >= d and a.cree_at < f), '[]')
  );
end $$;
