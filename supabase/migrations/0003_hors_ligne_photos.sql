-- Semaine 2 : saisies hors ligne (heure de la tablette), photos, rangement des livraisons.

-- L'heure officielle reste celle du serveur. Pour une saisie faite hors ligne puis envoyée plus tard,
-- on garde aussi l'heure de la tablette, bornée aux 24 dernières heures pour éviter une horloge déréglée.
alter table taches add column faite_at_client timestamptz;
alter table anomalies add column cree_at_client timestamptz;

drop function terminer_tache(uuid, uuid);
create function terminer_tache(p_tache uuid, p_profil uuid, p_at_client timestamptz default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_at timestamptz := now();
begin
  if p_at_client is not null and p_at_client between now() - interval '24 hours' and now() then
    v_at := p_at_client;   -- faite hors ligne : on retient l'heure réelle de la saisie
  end if;
  update taches set faite_at = v_at, faite_at_client = p_at_client, faite_par = p_profil
  where id = p_tache and faite_at is null
    and (est_siege() or site_id = mon_site())
    and exists (select 1 from profils p where p.id = p_profil and (p.site_id = taches.site_id or p.site_id is null));
end $$;

create function marquer_rangee(p_livraison uuid, p_at_client timestamptz) returns void
language sql security definer set search_path = public, extensions as $$
  update livraisons
  set range_at = case when p_at_client between now() - interval '24 hours' and now() then p_at_client else now() end
  where id = p_livraison and range_at is null and (est_siege() or site_id = mon_site())
$$;

-- Photos : seau privé, un dossier par site (1er segment du chemin = id du site).
-- Ni modification ni suppression depuis une tablette : une photo envoyée est une preuve.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy photos_lire on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (public.est_siege() or (storage.foldername(name))[1] = public.mon_site()::text));
create policy photos_envoyer on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = public.mon_site()::text);
