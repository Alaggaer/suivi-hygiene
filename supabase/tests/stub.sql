-- Imitation minimale de ce que Supabase fournit (auth, storage), pour tester les migrations sur un Postgres nu.
create schema auth; create role authenticated; create role anon;
create table auth.claims (jwt jsonb);
insert into auth.claims values ('{"app_metadata":{"role":"siege"}}');
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create function auth.role() returns text language sql as $$ select 'authenticated' $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jwt from auth.claims limit 1 $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
