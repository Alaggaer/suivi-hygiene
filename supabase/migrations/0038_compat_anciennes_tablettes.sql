-- Compatibilité : une tablette qui garde l'ancienne version de l'app en mémoire appelle encore generer_taches(date).
-- Elle obtient maintenant les tâches de SON restaurant pour aujourd'hui seulement (comme generer_taches_du_site),
-- au lieu d'une erreur « permission denied » et d'une liste vide. Le siège et la tâche planifiée gardent le comportement complet.
create or replace function generer_taches(p_jour date default (now() at time zone 'Europe/Paris')::date)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if auth.jwt() is not null and not est_siege() then   -- appel depuis une tablette (la tâche planifiée n'a pas de jeton)
    return generer_taches_du_site();
  end if;
  insert into taches (site_id, modele_id, type, titre, jour, echeance)
  select m.site_id, m.id, m.type, m.titre, p_jour,
         (p_jour + m.heure_limite) at time zone 'Europe/Paris'
  from taches_modeles m
  where m.actif and extract(isodow from p_jour)::smallint = any (m.jours)
  on conflict (modele_id, jour) do nothing;
  get diagnostics n = row_count;
  return n + generer_nettoyages(p_jour);
end $$;
grant execute on function generer_taches(date) to authenticated;
