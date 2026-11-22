-- Revue lot 3 : un document obligatoire expiré était compté deux fois au tableau du siège
-- (« manquant » et « expiré »). Il ne compte plus que comme expiré.
create or replace function documents_groupe() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not est_siege() then raise exception 'Réservé au siège' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('site_id', s.id,
      'manquants', (select count(*) from jsonb_array_elements(x.c->'attendus') a
                    where not (a->>'present')::boolean
                      and not exists (select 1 from jsonb_array_elements(x.c->'documents') d
                                      where d->>'type_cle' = a->>'cle' and d->>'etat' = 'retard')),
      'expires', (select count(*) from jsonb_array_elements(x.c->'documents') d where d->>'etat' = 'retard'),
      'bientot', (select count(*) from jsonb_array_elements(x.c->'documents') d where d->>'etat' = 'bientot'))
    order by s.nom)
    from sites s cross join lateral (select documents_site(s.id) c) x where s.actif), '[]'::jsonb);
end $$;
