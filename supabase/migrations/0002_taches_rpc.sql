-- Tâches : lecture du jour avec le nom de la personne, et clôture horodatée par le serveur.
-- security definer car la tablette ne peut pas lire la table profils (PIN) ; le filtre par site est refait ici.

create function taches_du_jour()
returns table (id uuid, type type_tache, titre text, echeance timestamptz, faite_at timestamptz, faite_par_nom text, escalade smallint)
language sql stable security definer set search_path = public as $$
  select t.id, t.type, t.titre, t.echeance, t.faite_at, p.nom, t.escalade
  from taches t left join profils p on p.id = t.faite_par
  where t.jour = (now() at time zone 'Europe/Paris')::date
    and (est_siege() or t.site_id = mon_site())
  order by t.echeance
$$;

create function terminer_tache(p_tache uuid, p_profil uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update taches set faite_at = now(), faite_par = p_profil
  where id = p_tache and faite_at is null
    and (est_siege() or site_id = mon_site())
    and exists (select 1 from profils p where p.id = p_profil and (p.site_id = taches.site_id or p.site_id is null));
end $$;
