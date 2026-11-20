-- Tests du schéma. Chaque bloc lève une erreur si une règle n'est pas respectée.
\set ON_ERROR_STOP 1
insert into sites(id,nom,ville) values ('00000000-0000-0000-0000-000000000001','DALLAS','CHAMBRAY'),('00000000-0000-0000-0000-000000000002','BOSTON','RENNES');
insert into profils(id,site_id,nom,role,pin_hash) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Karim','chef',crypt('1234',gen_salt('bf'))),
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000002','Lea','chef',crypt('5555',gen_salt('bf')));
insert into enceintes(id,site_id,nom,t_max) values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000001','CF positive',3);
insert into fournisseurs(id,nom) values ('00000000-0000-0000-0000-0000000000f1','Pomona');
insert into taches_modeles(site_id,type,titre,heure_limite) values
  ('00000000-0000-0000-0000-000000000001','releves','Relevé matin','11:00'),
  ('00000000-0000-0000-0000-000000000001','huile','Huile','11:30');

do $$ begin
  assert generer_taches() = 2, 'génère 2 tâches';
  assert generer_taches() = 0, 'pas de doublon de tâches si on relance';
  assert verifier_pin('00000000-0000-0000-0000-0000000000a1','1234'), 'bon PIN accepté';
  assert not verifier_pin('00000000-0000-0000-0000-0000000000a1','0000'), 'mauvais PIN refusé';
end $$;

-- relevé conforme accepté ; hors seuil sans action refusé
insert into releves(site_id,enceinte_id,valeur,t_max,par) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1',2.5,3,'00000000-0000-0000-0000-0000000000a1');
do $$ begin
  begin
    insert into releves(site_id,enceinte_id,valeur,t_max,par) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1',6,3,'00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : relevé hors seuil sans action accepté';
  exception when check_violation then null; end;
  begin
    delete from releves;
    raise exception 'ÉCHEC : suppression possible';
  exception when raise_exception then
    if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
end $$;
update releves set action = 'test';
do $$ begin assert (select count(*) from journal where tbl = 'releves') = 1, 'modification historisée'; end $$;

-- clôture d'une tâche : heure de la tablette si plausible, sinon heure du serveur ; personne d'un autre site refusée
do $$ declare t uuid; begin
  select id into t from taches where titre = 'Huile';
  perform terminer_tache(t, '00000000-0000-0000-0000-0000000000a2', now());
  assert (select faite_at from taches where id = t) is null, 'personne d''un autre site ne peut pas clore la tâche';
  perform terminer_tache(t, '00000000-0000-0000-0000-0000000000a1', now() - interval '40 minutes');
  assert (select faite_at from taches where id = t) between now() - interval '41 minutes' and now() - interval '39 minutes', 'heure hors ligne retenue';
  perform terminer_tache(t, '00000000-0000-0000-0000-0000000000a1', now());
  assert (select faite_at from taches where id = t) < now() - interval '39 minutes', 'tâche déjà faite : pas réécrite';
  select id into t from taches where titre = 'Relevé matin';
  perform terminer_tache(t, '00000000-0000-0000-0000-0000000000a1', now() - interval '3 days');
  assert (select faite_at from taches where id = t) > now() - interval '1 minute', 'horloge déréglée : heure du serveur';
  assert (select count(*) from taches_du_jour() where faite_par_nom = 'Karim') = 2, 'taches_du_jour donne le nom';
end $$;

-- livraisons : envoi rejoué sans doublon, non conforme exige motif et action, rangement idempotent
insert into livraisons(id,site_id,fournisseur_id,t_camion,photo_bl,conforme,par) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1',3,'x.webp',true,'00000000-0000-0000-0000-0000000000a1') on conflict (id) do nothing;
insert into livraisons(id,site_id,fournisseur_id,t_camion,photo_bl,conforme,par) values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1',3,'x.webp',true,'00000000-0000-0000-0000-0000000000a1') on conflict (id) do nothing;
do $$ begin
  assert (select count(*) from livraisons) = 1, 'envoi rejoué ignoré';
  begin
    insert into livraisons(site_id,fournisseur_id,t_camion,photo_bl,conforme,par) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1',8,'x.webp',false,'00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : livraison non conforme sans motif acceptée';
  exception when check_violation then null; end;
  perform marquer_rangee('00000000-0000-0000-0000-0000000000d1', now() - interval '5 minutes');
  perform marquer_rangee('00000000-0000-0000-0000-0000000000d1', now());
  assert (select range_at from livraisons) < now() - interval '4 minutes', 'rangement : première heure gardée';
end $$;


-- anomalies : cycle et droits
insert into profils(id,site_id,nom,role,pin_hash) values ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','Julie','equipe',crypt('1111',gen_salt('bf')));
insert into anomalies(id,site_id,source,categorie,gravite,titre) values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000001','manuel','Matériel','mineure','Joint abîmé');
do $$ begin
  perform changer_statut_anomalie('00000000-0000-0000-0000-0000000000c1','traitee','00000000-0000-0000-0000-0000000000a3','Joint changé');
  perform changer_statut_anomalie('00000000-0000-0000-0000-0000000000c1','traitee','00000000-0000-0000-0000-0000000000a3','Joint changé');  -- rejoué
  assert (select statut from anomalies where id='00000000-0000-0000-0000-0000000000c1') = 'traitee', 'traitée par l''équipe';
  begin
    perform changer_statut_anomalie('00000000-0000-0000-0000-0000000000c1','verifiee','00000000-0000-0000-0000-0000000000a3');
    raise exception 'ÉCHEC : un équipier a pu vérifier';
  exception when insufficient_privilege then null; end;
  perform changer_statut_anomalie('00000000-0000-0000-0000-0000000000c1','verifiee','00000000-0000-0000-0000-0000000000a1');
  assert (select statut from anomalies where id='00000000-0000-0000-0000-0000000000c1') = 'verifiee', 'vérifiée par le chef';
end $$;

-- relances : une seule fois par seuil, et anomalie pour une tâche non faite la veille
insert into taches(site_id,type,titre,jour,echeance) values
  ('00000000-0000-0000-0000-000000000001','releves','Relevé soir (retard 40 min)',current_date, now() - interval '40 minutes'),
  ('00000000-0000-0000-0000-000000000001','releves','Relevé hier',current_date - 1, now() - interval '20 hours');
insert into anomalies(site_id,source,categorie,gravite,titre) values ('00000000-0000-0000-0000-000000000001','manuel','Nuisibles','critique','Souris en réserve');
insert into anomalies(site_id,source,categorie,gravite,titre,cree_at) values ('00000000-0000-0000-0000-000000000001','manuel','Propreté','majeure','Hotte sale', now() - interval '25 hours');
do $$ declare premier int; begin
  premier := escalader();
  assert premier > 0, 'des relances sont créées';
  assert escalader() = 0, 'relancer une 2e fois ne crée rien';
  assert (select count(*) from notifications where destinataire='chef' and titre like '%Relevé soir%') = 1, 'chef prévenu à +30 min';
  assert (select count(*) from notifications where destinataire='responsable' and titre like '%Relevé soir%') = 0, 'pas encore le responsable';
  assert (select count(*) from notifications where destinataire='responsable' and titre like '%Relevé hier%') = 1, 'responsable prévenu à +2 h';
  assert (select count(*) from anomalies where source='tache' and titre like '%Relevé hier%') = 1, 'tâche non faite hier → anomalie';
  assert (select count(*) from notifications where destinataire='siege' and titre like 'Critique%') = 1, 'critique → siège';
  assert (select count(*) from notifications where destinataire='siege' and titre like 'Non traitée : Hotte%') = 1, 'majeure > 24 h → siège';
end $$;


-- tableau du siège (rôle siège dans le jeton)
do $$ declare r record; begin
  select * into r from tableau_siege(7) where nom = 'DALLAS';
  assert r.taches_total >= 2, 'tâches échues comptées';
  assert r.taches_non_faites >= 2, 'tâches non faites comptées (retard + hier)';
  assert r.anomalies_critiques = 1, 'anomalie critique comptée';
  assert r.livraisons = 1 and r.livraisons_nc = 0, 'livraisons comptées';
  assert (select count(*) from tableau_siege(7)) = 2, 'un rang par site';
  assert (select livraisons from fournisseurs_non_conformes(30) where fournisseur = 'Pomona') = 1, 'fournisseurs';
end $$;

-- règles d'accès : une tablette ne voit que son site
create role tablette; grant usage on schema public, auth to tablette; grant select, insert, update on all tables in schema public to tablette;
grant select on auth.claims to tablette; grant execute on all functions in schema public, auth to tablette;
update auth.claims set jwt = '{"app_metadata":{"role":"tablette","site_id":"00000000-0000-0000-0000-000000000002"}}';
set role tablette;
do $$ begin
  assert (select count(*) from releves) = 0, 'BOSTON ne voit pas les relevés de DALLAS';
  assert (select count(*) from taches) = 0, 'BOSTON ne voit pas les tâches de DALLAS';
  assert (select count(*) from profils_du_site()) = 1, 'BOSTON ne voit que ses employés';
  assert not verifier_pin('00000000-0000-0000-0000-0000000000a1','1234'), 'PIN d''un autre site refusé';
  begin
    insert into releves(site_id,enceinte_id,valeur,t_max,par) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1',2,3,'00000000-0000-0000-0000-0000000000a2');
    raise exception 'ÉCHEC : écriture pour un autre site acceptée';
  exception when insufficient_privilege then null; end;
  begin
    perform * from tableau_siege(7);
    raise exception 'ÉCHEC : une tablette lit le tableau du siège';
  exception when insufficient_privilege then null; end;
  begin
    perform pin_hash from profils;
    assert (select count(*) from profils) = 0, 'les PIN ne sont pas lisibles';
  end;
end $$;
reset role;
\echo TOUS_LES_TESTS_SQL_OK
