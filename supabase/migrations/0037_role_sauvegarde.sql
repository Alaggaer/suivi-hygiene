-- Compte dédié à la sauvegarde nocturne : il lit tout mais ne peut rien modifier,
-- sauf ajouter la ligne « sauvegarde réussie » que la base surveille.
-- Il n'a pas de mot de passe tant que le siège ne lui en donne pas un (il ne peut donc pas se connecter avant).
do $$ begin create role sauvegarde login bypassrls connection limit 3; exception when duplicate_object then null; end $$;
grant pg_read_all_data to sauvegarde;
grant usage on schema public to sauvegarde;
grant insert on public.sauvegardes to sauvegarde;
