-- Tâches planifiées du serveur, exécutées comme pg_cron : sans jeton de connexion, trois fois de suite.
-- Vérifie : rien ne se recrée en boucle (passages 2 et 3 identiques), origine des anomalies conservée, aucune erreur de droits.
-- Autonome : crée ses propres données dans une transaction annulée à la fin (utilisable sur la base de recette).
-- Lancé par tests/run.sh (local) et par le workflow « recette » (vrai Supabase).
\set ON_ERROR_STOP 1
begin;

-- Contexte « tâche planifiée » : aucun jeton (en local, le faux auth lit auth.claims).
do $$ begin
  if to_regclass('auth.claims') is not null then execute 'update auth.claims set jwt = null'; end if;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.path', '', true);
end $$;
do $$ begin assert auth.jwt() is null, 'contexte de test : il ne doit pas y avoir de jeton'; end $$;

-- Données : un restaurant avec une tâche oubliée hier, une livraison jamais rangée, une action en retard,
-- un document expiré, une alerte produit sans réponse.
insert into sites (id, nom, ville) values ('5e000000-0000-0000-0000-000000000001', 'TEST SERVEUR', 'NULLE PART');
insert into profils (id, site_id, nom, role, pin_hash) values
  ('5e000000-0000-0000-0000-0000000000c1', '5e000000-0000-0000-0000-000000000001', 'Chef test', 'chef', crypt('9999', gen_salt('bf'))),
  ('5e000000-0000-0000-0000-0000000000c2', null, 'Siège test', 'siege', crypt('9998', gen_salt('bf')));
insert into fournisseurs (id, nom) values ('5e000000-0000-0000-0000-0000000000f1', 'Fournisseur test');
insert into taches (id, site_id, type, titre, jour, echeance) values
  ('5e000000-0000-0000-0000-0000000000a1', '5e000000-0000-0000-0000-000000000001', 'autre', 'Tâche oubliée',
   (now() at time zone 'Europe/Paris')::date - 1, now() - interval '20 hours');
insert into taches_modeles (site_id, type, titre, heure_limite, jours) values
  ('5e000000-0000-0000-0000-000000000001', 'autre', 'Modèle test', '11:00', '{1,2,3,4,5,6,7}');
insert into livraisons (id, site_id, fournisseur_id, t_camion, photo_bl, conforme, par, at) values
  ('5e000000-0000-0000-0000-0000000000d1', '5e000000-0000-0000-0000-000000000001', '5e000000-0000-0000-0000-0000000000f1',
   3, 'x.webp', true, '5e000000-0000-0000-0000-0000000000c1', now() - interval '2 hours');
insert into anomalies (id, site_id, source, categorie, gravite, titre, action_prevue, echeance) values
  ('5e000000-0000-0000-0000-0000000000e1', '5e000000-0000-0000-0000-000000000001', 'manuel', 'Test', 'mineure', 'Action en retard test',
   'Réparer', (now() at time zone 'Europe/Paris')::date - 3);
insert into documents_pms (id, site_id, type_cle, titre, fichier, expire_le, par) values
  ('5e000000-0000-0000-0000-0000000000b1', '5e000000-0000-0000-0000-000000000001', (select cle from documents_types order by cle limit 1),
   'Document test', '5e000000-0000-0000-0000-000000000001/pieces/x.pdf', (now() at time zone 'Europe/Paris')::date - 1,
   '5e000000-0000-0000-0000-0000000000c1');
insert into alertes_produit (type, produit, cree_par, cree_at, sites) values
  ('retrait', 'Produit test', '5e000000-0000-0000-0000-0000000000c2', now() - interval '2 days', '{5e000000-0000-0000-0000-000000000001}');

do $$ begin
  assert (select at from livraisons where id = '5e000000-0000-0000-0000-0000000000d1') < now() - interval '1 hour',
    'écriture du serveur : l''heure fournie est gardée (pas remplacée par l''heure de réception)';
end $$;

create temp table passage (n int, anomalies bigint, notifications bigint, taches bigint);
create function pg_temp.passer(p int) returns void language plpgsql as $$
begin
  perform escalader();
  perform generer_taches((now() at time zone 'Europe/Paris')::date);
  perform relancer_alertes_produit();
  perform relancer_pms();
  perform relancer_visites();
  perform relancer_documents();
  insert into passage select p,
    (select count(*) from anomalies where site_id = '5e000000-0000-0000-0000-000000000001'),
    (select count(*) from notifications where site_id = '5e000000-0000-0000-0000-000000000001'),
    (select count(*) from taches where site_id = '5e000000-0000-0000-0000-000000000001');
end $$;

-- 1er passage : le serveur fait son travail (et peut générer des tâches qui, déjà en retard, s'escaladent au 2e).
-- Les passages 2 et 3 doivent être identiques : rien ne doit se recréer en boucle.
select pg_temp.passer(1);
select pg_temp.passer(2);
select pg_temp.passer(3);

do $$ declare a passage; b passage; begin
  select * into a from passage where n = 2;
  select * into b from passage where n = 3;
  assert a.anomalies = b.anomalies, format('3e passage : anomalies %s → %s (doublons)', a.anomalies, b.anomalies);
  assert a.notifications = b.notifications, format('3e passage : notifications %s → %s (doublons)', a.notifications, b.notifications);
  assert a.taches = b.taches, format('3e passage : tâches %s → %s (doublons)', a.taches, b.taches);
  -- Ce que le serveur devait produire, avec la bonne origine
  assert (select count(*) from anomalies where source = 'tache' and ref_id = '5e000000-0000-0000-0000-0000000000a1') = 1,
    'tâche oubliée : exactement une anomalie, origine « tache »';
  assert (select count(*) from anomalies where source = 'rangement' and ref_id = '5e000000-0000-0000-0000-0000000000d1') = 0,
    'rangement plus suivi : aucune anomalie de rangement';
  assert not exists (select 1 from anomalies where site_id = '5e000000-0000-0000-0000-000000000001'
                     and source = 'manuel' and id <> '5e000000-0000-0000-0000-0000000000e1'),
    'aucune anomalie du serveur ne doit perdre son origine';
  assert (select count(*) from taches where site_id = '5e000000-0000-0000-0000-000000000001'
          and jour = (now() at time zone 'Europe/Paris')::date) >= 1, 'génération des tâches du jour';
  assert (select echeance_relancee from anomalies where id = '5e000000-0000-0000-0000-0000000000e1'), 'action en retard relancée';
  assert exists (select 1 from notifications where ref_table = 'documents_pms' and ref_id = '5e000000-0000-0000-0000-0000000000b1'), 'document expiré signalé';
  assert exists (select 1 from notifications where ref_table = 'alertes_produit' and site_id = '5e000000-0000-0000-0000-000000000001'), 'alerte sans réponse signalée';
end $$;

rollback;
\echo TACHES_PLANIFIEES_OK
