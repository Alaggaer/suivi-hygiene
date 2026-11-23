-- Tests du schéma. Chaque bloc lève une erreur si une règle n'est pas respectée.
\set ON_ERROR_STOP 1
insert into sites(id,nom,ville) values ('00000000-0000-0000-0000-000000000001','DALLAS','CHAMBRAY'),('00000000-0000-0000-0000-000000000002','BOSTON','RENNES');
insert into profils(id,site_id,nom,role,pin_hash) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Karim','chef',crypt('1234',gen_salt('bf'))),
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000002','Lea','chef',crypt('5555',gen_salt('bf')));
insert into enceintes(id,site_id,nom,t_max) values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000001','CF positive',3),('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-000000000002','CF positive',3);
insert into fournisseurs(id,nom) values ('00000000-0000-0000-0000-0000000000f1','Pomona');
insert into taches_modeles(site_id,type,titre,heure_limite) values
  ('00000000-0000-0000-0000-000000000001','releves','Relevé matin','11:00'),
  ('00000000-0000-0000-0000-000000000001','huile','Huile','11:30');

update nettoyage_elements set actif = false;   -- plan type : activé seulement dans son propre test
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
  begin
    perform terminer_tache(t, '00000000-0000-0000-0000-0000000000a2', now());
    raise exception 'ÉCHEC : personne d''un autre site clôt la tâche';
  exception when insufficient_privilege then null; end;
  assert (select faite_at from taches where id = t) is null, 'personne d''un autre site ne peut pas clore la tâche';
  perform terminer_tache(t, '00000000-0000-0000-0000-0000000000a1', now() - interval '40 minutes');
  assert (select faite_at from taches where id = t) between now() - interval '41 minutes' and now() - interval '39 minutes', 'heure hors ligne retenue';
  perform terminer_tache(t, '00000000-0000-0000-0000-0000000000a1', now());
  assert (select faite_at from taches where id = t) < now() - interval '39 minutes', 'tâche déjà faite : pas réécrite';
  select id into t from taches where titre = 'Relevé matin';
  perform terminer_tache(t, '00000000-0000-0000-0000-0000000000a1', now() - interval '10 days');
  assert (select faite_at from taches where id = t) > now() - interval '1 minute', 'horloge déréglée (plus de 7 jours) : heure du serveur';
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



-- rangement non validé : anomalie après 45 min, une seule fois
insert into livraisons(id,site_id,fournisseur_id,t_camion,photo_bl,conforme,par,at) values ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1',3,'y.webp',true,'00000000-0000-0000-0000-0000000000a1', now() - interval '50 minutes');
do $$ begin
  perform escalader(); perform escalader();
  assert (select count(*) from anomalies where source = 'rangement' and ref_id = '00000000-0000-0000-0000-0000000000d2') = 1, 'rangement non validé → 1 anomalie';
  assert (select count(*) from anomalies where source = 'rangement' and ref_id = '00000000-0000-0000-0000-0000000000d1') = 0, 'livraison rangée → pas d''anomalie';
end $$;


do $$ declare r record; begin
  select * into r from resume_jour() where nom = 'DALLAS';
  assert r.taches_total >= 2 and r.livraisons >= 1, 'résumé du jour';
end $$;

-- tableau du siège (rôle siège dans le jeton)
do $$ declare r record; begin
  select * into r from tableau_siege(7) where nom = 'DALLAS';
  assert r.taches_total >= 2, 'tâches échues comptées';
  assert r.taches_non_faites >= 2, 'tâches non faites comptées (retard + hier)';
  assert r.anomalies_critiques = 1, 'anomalie critique comptée';
  assert r.livraisons = 2 and r.livraisons_nc = 0, 'livraisons comptées';
  assert (select count(*) from tableau_siege(7)) = 2, 'un rang par site';
  assert (select livraisons from fournisseurs_non_conformes(30) where fournisseur = 'Pomona') = 2, 'fournisseurs';
end $$;

-- huile : compteur de jours d'utilisation depuis le dernier changement, « non utilisée » ne compte pas
insert into friteuses(id,site_id,nom,litres) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000001','Friteuse 1',25),
  ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000001','Friteuse 2',25);
insert into huiles(site_id,friteuse_id,polaires,changement,non_utilisee,par,at) values
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1',8,  true, false,'00000000-0000-0000-0000-0000000000a1', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1',12, false,false,'00000000-0000-0000-0000-0000000000a1', now() - interval '4 days'),
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1',null,false,true, '00000000-0000-0000-0000-0000000000a1', now() - interval '3 days'),
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1',15, false,false,'00000000-0000-0000-0000-0000000000a1', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1',16, false,false,'00000000-0000-0000-0000-0000000000a1', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b2',null,false,true, '00000000-0000-0000-0000-0000000000a1', now());
do $$ declare r record; begin
  select * into r from etat_friteuses() where friteuse_id = '00000000-0000-0000-0000-0000000000b1';
  assert r.jours_utilisation = 3, format('friteuse 1 : 3 jours utilisés (changement, J+1, J+3), obtenu %s', r.jours_utilisation);
  assert r.dernier_changement is not null, 'date du dernier changement connue';
  assert r.aujourd_hui_at is null, 'friteuse 1 pas encore faite aujourd''hui';
  select * into r from etat_friteuses() where friteuse_id = '00000000-0000-0000-0000-0000000000b2';
  assert r.jours_utilisation = 0 and r.aujourd_hui_non_utilisee, 'friteuse 2 : non utilisée aujourd''hui, 0 jour';
  assert (select valeur->>'jours_max' from reglages where cle = 'huile') = '14', 'durée max 14 j réglée';
  begin
    insert into huiles(site_id,friteuse_id,polaires,non_utilisee,par) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b2',18,true,'00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : « non utilisée » avec une mesure acceptée';
  exception when check_violation then null; end;
end $$;

-- siège v2 : le siège traite et vérifie sous un profil à son nom ; preuves du jour ; compteurs du tableau
update auth.claims set jwt = '{"sub":"00000000-0000-0000-0000-0000000000c1","app_metadata":{"role":"siege"}}';
insert into auth.users values ('00000000-0000-0000-0000-0000000000c1','direction@exemple.fr');
insert into anomalies(id,site_id,source,categorie,gravite,titre) values
  ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000001','manuel','Matériel','critique','Porte CF cassée'),
  ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-000000000001','manuel','Matériel','mineure','Ampoule');
do $$ declare r record; t record; j jsonb; begin
  select * into t from tableau_siege_v2(7) where nom = 'DALLAS';
  assert t.anomalies_critiques >= 1 and t.anomalies_a_verifier = 0, 'critique comptée, rien à vérifier';
  perform siege_changer_statut('00000000-0000-0000-0000-0000000000d1', 'traitee', 'Réparée par le frigoriste');
  select * into t from tableau_siege_v2(7) where nom = 'DALLAS';
  assert t.anomalies_a_verifier = 1, 'traitée = à vérifier';
  assert t.anomalies_critiques >= 1, 'une critique traitée mais non vérifiée reste comptée';
  perform siege_changer_statut('00000000-0000-0000-0000-0000000000d1', 'verifiee');
  assert (select count(*) from profils where auth_id = '00000000-0000-0000-0000-0000000000c1') = 1, 'un seul profil siège, réutilisé';
  select * into r from anomalies_siege() where id = '00000000-0000-0000-0000-0000000000d1';
  assert r.statut = 'verifiee' and r.verifiee_par = 'Siège (direction)' and r.traitee_par = 'Siège (direction)', format('traçabilité siège : %s', r.verifiee_par);
  assert r.restaurant = 'DALLAS', 'nom du restaurant';
  assert (select count(*) from anomalies_siege() where id = '00000000-0000-0000-0000-0000000000d2') = 1, 'non traitée listée';
  j := preuves_jour('00000000-0000-0000-0000-000000000001', (now() at time zone 'Europe/Paris')::date);
  assert jsonb_array_length(j->'releves') >= 1 and jsonb_array_length(j->'taches') >= 2 and jsonb_array_length(j->'anomalies') >= 2, format('preuves du jour : %s', j);
  assert j ? 'livraisons' and j ? 'produits' and j ? 'huiles', 'toutes les rubriques présentes';
  assert t.huile_trop_vieille = 0, 'huile de 3 jours : pas trop vieille';
  update reglages set valeur = valeur || '{"jours_max": 2}' where cle = 'huile';
  assert (select huile_trop_vieille from tableau_siege_v2(7) where nom = 'DALLAS') = 1, 'au-delà du maximum : signalée';
  update reglages set valeur = valeur || '{"jours_max": 14}' where cle = 'huile';
end $$;
update auth.claims set jwt = '{"app_metadata":{"role":"siege"}}';

-- siège v3 : état du jour par restaurant, historique 30 jours
do $$ declare e record; n int; begin
  select * into e from etat_restaurants() where nom = 'DALLAS';
  assert e.taches_total >= 2 and e.enceintes = 1 and e.enceintes_relevees = 1, format('état du jour DALLAS : %s', row_to_json(e));
  assert e.friteuses = 2 and e.friteuses_faites = 1, format('friteuses : %s/%s', e.friteuses_faites, e.friteuses);
  assert e.derniere_saisie is not null and e.derniere_saisie_par is not null, 'dernière saisie connue';
  assert e.anomalies_critiques >= 1, 'critique comptée';
  select count(*) into n from historique_site('00000000-0000-0000-0000-000000000001', 30);
  assert n = 30, format('30 jours d''historique, obtenu %s', n);
  assert (select taches_echues from historique_site('00000000-0000-0000-0000-000000000001', 30) order by jour desc limit 1) >= 1, 'aujourd''hui compte ses tâches échues';
end $$;

-- vraisemblance : valeurs impossibles refusées
do $$ begin
  begin
    insert into releves(site_id,enceinte_id,valeur,par) select site_id, id, -4, '00000000-0000-0000-0000-0000000000a1' from enceintes where t_max >= 0 limit 1;
    raise exception 'ÉCHEC : −4 °C accepté dans une enceinte positive';
  exception when invalid_parameter_value then null; end;
  begin
    insert into huiles(site_id,friteuse_id,polaires,par) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1',250,'00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : 250 %% d''huile accepté';
  exception when invalid_parameter_value then null; end;
end $$;

-- rattrapage siège : correction tracée d'une saisie, sans rien effacer
update auth.claims set jwt = '{"sub":"00000000-0000-0000-0000-0000000000c1","app_metadata":{"role":"siege"}}';
do $$ declare r uuid; j jsonb; n int; begin
  select id into r from releves where site_id = '00000000-0000-0000-0000-000000000001' order by at limit 1;
  begin perform siege_corriger('releves', r, 'non'); raise exception 'ÉCHEC : motif trop court accepté';
  exception when invalid_parameter_value then null; end;
  begin perform siege_corriger('releves', r, 'Erreur de saisie', -50); raise exception 'ÉCHEC : valeur corrigée impossible acceptée';
  exception when invalid_parameter_value then null; end;
  perform siege_corriger('releves', r, 'Signe oublié à la saisie', 3.5);
  select count(*) into n from releves where id = r;
  assert n = 1, 'la saisie d''origine est conservée';
  j := preuves_jour('00000000-0000-0000-0000-000000000001', (now() at time zone 'Europe/Paris')::date);
  assert (select x->'correction'->>'valeur' from jsonb_array_elements(j->'releves') x where x->>'id' = r::text) = '3.5', format('correction visible dans les preuves : %s', j->'releves');
  assert (select x->'correction'->>'par' from jsonb_array_elements(j->'releves') x where x->>'id' = r::text) = 'Siège (direction)', 'auteur de la correction';
end $$;
update auth.claims set jwt = '{"app_metadata":{"role":"siege"}}';

-- heure réelle : une saisie faite hors ligne s'affiche à l'heure de la tablette (moins de 24 h), sinon à l'heure de réception
do $$ declare j jsonb; r uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); begin
  insert into releves(id,site_id,enceinte_id,valeur,par,at_client) select r, site_id, id, 2, '00000000-0000-0000-0000-0000000000a1', now() - interval '3 hours' from enceintes where t_max >= 0 and site_id = '00000000-0000-0000-0000-000000000001' limit 1;
  insert into releves(id,site_id,enceinte_id,valeur,par,at_client) select r2, site_id, id, 2, '00000000-0000-0000-0000-0000000000a1', now() + interval '5 hours' from enceintes where t_max >= 0 and site_id = '00000000-0000-0000-0000-000000000001' limit 1;
  j := preuves_jour('00000000-0000-0000-0000-000000000001', ((now() - interval '3 hours') at time zone 'Europe/Paris')::date);
  assert abs(extract(epoch from ((select (x->>'at')::timestamptz from jsonb_array_elements(j->'releves') x where x->>'id' = r::text) - (now() - interval '3 hours')))) < 5, 'heure de la tablette retenue';
  assert (select (x->>'recu_at')::timestamptz from jsonb_array_elements(j->'releves') x where x->>'id' = r::text) > now() - interval '1 minute', 'heure de réception gardée';
  j := preuves_jour('00000000-0000-0000-0000-000000000001', (now() at time zone 'Europe/Paris')::date);
  assert abs(extract(epoch from ((select (x->>'at')::timestamptz from jsonb_array_elements(j->'releves') x where x->>'id' = r2::text) - now()))) < 60, 'heure tablette dans le futur ignorée';
end $$;

-- réception v2 : verdict cohérent avec les températures, BL sur plusieurs pages, refus partiel
do $$ declare f uuid; j jsonb; l uuid := gen_random_uuid(); begin
  select id into f from fournisseurs limit 1;
  begin
    insert into livraisons(site_id,fournisseur_id,t_camion,t_frais,photo_bl,conforme,par) values ('00000000-0000-0000-0000-000000000001', f, 9, 3, 'x/bl.webp', true, '00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : livraison à +9 °C enregistrée conforme';
  exception when invalid_parameter_value then null; end;
  insert into livraisons(id,site_id,fournisseur_id,t_camion,t_frais,photo_bl,photos_bl_suite,conforme,motifs,action,produits_refuses,par)
  values (l, '00000000-0000-0000-0000-000000000001', f, 9, 7, 'x/bl1.webp', array['x/bl2.webp','x/bl3.webp'], false, array['Température'], 'Une partie refusée', 'Salade, herbes', '00000000-0000-0000-0000-0000000000a1');
  j := preuves_jour('00000000-0000-0000-0000-000000000001', (now() at time zone 'Europe/Paris')::date);
  assert (select jsonb_array_length(x->'photos_bl_suite') from jsonb_array_elements(j->'livraisons') x where x->>'id' = l::text) = 2, 'pages suivantes du BL dans les preuves';
  assert (select x->>'produits_refuses' from jsonb_array_elements(j->'livraisons') x where x->>'id' = l::text) = 'Salade, herbes', 'produits refusés dans les preuves';
end $$;

-- rattrapage d'une saisie oubliée par le siège
update auth.claims set jwt = '{"sub":"00000000-0000-0000-0000-0000000000c1","app_metadata":{"role":"siege"}}';
do $$ declare enc uuid; r uuid; j jsonb; begin
  select id into enc from enceintes where site_id = '00000000-0000-0000-0000-000000000001' limit 1;
  begin perform siege_rattraper('releve', enc, now() + interval '1 hour', 3, 'Relevé oublié, valeur notée sur papier');
    raise exception 'ÉCHEC : rattrapage dans le futur accepté';
  exception when invalid_parameter_value then null; end;
  begin perform siege_rattraper('releve', enc, now() - interval '3 hours', 12, 'Relevé oublié, valeur notée sur papier');
    raise exception 'ÉCHEC : hors seuil sans action accepté';
  exception when invalid_parameter_value then null; end;
  begin perform siege_rattraper('releve', enc, now() - interval '3 hours', 3, 'oups');
    raise exception 'ÉCHEC : motif trop court accepté';
  exception when invalid_parameter_value then null; end;
  r := siege_rattraper('releve', enc, now() - interval '3 hours', 1.5, 'Relevé oublié, valeur notée sur papier');
  j := preuves_jour('00000000-0000-0000-0000-000000000001', ((now() - interval '3 hours') at time zone 'Europe/Paris')::date);
  assert (select x->>'rattrapage' from jsonb_array_elements(j->'releves') x where x->>'id' = r::text) = 'Relevé oublié, valeur notée sur papier', 'rattrapage visible dans les preuves';
  assert (select x->>'par' from jsonb_array_elements(j->'releves') x where x->>'id' = r::text) = 'Siège (direction)', 'auteur = siège';
  begin perform siege_rattraper('huile', '00000000-0000-0000-0000-0000000000b1', now() - interval '2 hours', 27, 'Mesure oubliée ce midi', null, 'filtree');
    raise exception 'ÉCHEC : huile au rouge « filtrée » acceptée';
  exception when invalid_parameter_value then null; end;
  perform siege_rattraper('huile', '00000000-0000-0000-0000-0000000000b1', now() - interval '2 hours', 18, 'Mesure oubliée ce midi', null, 'filtree');
end $$;
update auth.claims set jwt = '{"app_metadata":{"role":"siege"}}';

-- stocks morts : le siège déclare un produit retiré de la carte
update auth.claims set jwt = '{"sub":"00000000-0000-0000-0000-0000000000c1","app_metadata":{"role":"siege"}}';
do $$ declare p uuid; j jsonb; begin
  begin perform siege_retirer_produit(' '); raise exception 'ÉCHEC : produit sans nom accepté';
  exception when invalid_parameter_value then null; end;
  p := siege_retirer_produit('Sauce cheddar ancienne recette', null, 'À écouler en plat du jour avant le 30/11');
  insert into inventaires_stock (id, produit_id, site_id, reste, quantite, dlc, photo, decision, par)
  values (gen_random_uuid(), p, '00000000-0000-0000-0000-000000000001', true, '3 bidons', current_date + 10, 'x/p.webp', 'a_ecouler', '00000000-0000-0000-0000-0000000000a1');
  j := stocks_morts_siege();
  assert (select x->>'nom' from jsonb_array_elements(j) x where x->>'id' = p::text) = 'Sauce cheddar ancienne recette', 'produit visible au siège';
  assert (select s->>'etat' from jsonb_array_elements(j) x, jsonb_array_elements(x->'sites') s where x->>'id' = p::text and s->>'restaurant' = 'DALLAS') = 'a_ecouler', 'DALLAS : à écouler';
  assert (select s->>'etat' from jsonb_array_elements(j) x, jsonb_array_elements(x->'sites') s where x->>'id' = p::text and s->>'restaurant' = 'BOSTON') = 'a_verifier', 'BOSTON : à vérifier';
  begin
    insert into inventaires_stock (id, produit_id, site_id, reste, par) values (gen_random_uuid(), p, '00000000-0000-0000-0000-000000000001', true, '00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : « il en reste » sans quantité, photo ni décision accepté';
  exception when check_violation then null; end;
end $$;
update auth.claims set jwt = '{"app_metadata":{"role":"siege"}}';

-- gestion siège : restaurants, employés, PIN
update auth.claims set jwt = '{"sub":"00000000-0000-0000-0000-0000000000c1","app_metadata":{"role":"siege"}}';
do $$ declare s uuid; pin text; pin2 text; e uuid; begin
  s := siege_creer_restaurant('Seattle', 'Lyon');
  assert (select nom from sites where id = s) = 'SEATTLE', 'nom en majuscules';
  assert (select count(*) from taches_modeles where site_id = s) = 4, 'tâches habituelles créées (le nettoyage vient du plan)';
  begin perform siege_creer_restaurant('seattle', 'Lyon'); raise exception 'ÉCHEC : doublon de restaurant accepté';
  exception when invalid_parameter_value then null; end;
  pin := siege_ajouter_employe(s, 'Nora', 'chef');
  assert pin ~ '^\d{4}$', 'PIN à 4 chiffres';
  select id into e from employes_site(s) where nom = 'Nora';
  assert (select pin_hash = crypt(pin, pin_hash) from profils where id = e), 'PIN enregistré chiffré';
  pin2 := siege_nouveau_pin(e);
  assert (select pin_hash = crypt(pin2, pin_hash) and (pin = pin2 or pin_hash <> crypt(pin, pin_hash)) from profils where id = e), 'nouveau PIN : l''ancien ne marche plus';
  perform siege_modifier_employe(e, 'Nora B.', 'responsable', false);
  assert (select nom || role::text || actif::text from profils where id = e) = 'Nora B.responsablefalse', 'employé modifié et désactivé';
  begin perform siege_ajouter_employe(s, 'Pirate', 'siege'); raise exception 'ÉCHEC : compte siège créé comme employé';
  exception when invalid_parameter_value then null; end;
  update sites set actif = false where id = s;   -- ne gêne pas les tests suivants (restaurants actifs)
end $$;
update auth.claims set jwt = '{"app_metadata":{"role":"siege"}}';

-- alertes produit : retrait fournisseur et prolongation DDM
update auth.claims set jwt = '{"sub":"00000000-0000-0000-0000-0000000000c1","app_metadata":{"role":"siege"}}';
do $$ declare r uuid; pr uuid; j jsonb; n int; begin
  begin
    perform siege_creer_alerte('prolongation', 'Steak haché 15%', null, 'L123', current_date, current_date + 30, false, null, null, null, null);
    raise exception 'ÉCHEC : prolongation d''une DLC acceptée';
  exception when invalid_parameter_value then null; end;
  begin
    perform siege_creer_alerte('prolongation', 'Sauce barbecue', null, 'L9', current_date + 5, current_date, true, null, null, null, null);
    raise exception 'ÉCHEC : nouvelle DDM antérieure acceptée';
  exception when check_violation then null; end;
  begin
    perform siege_creer_alerte('retrait', 'Sauce barbecue', null, null, null, null, false, null, 'x/pirate.pdf', 'application/pdf', null);
    raise exception 'ÉCHEC : document hors du dossier alertes accepté';
  exception when invalid_parameter_value then null; end;
  r := siege_creer_alerte('retrait', 'Cheddar tranché', null, 'L2611A, L2611B', null, null, false, 'Isoler et attendre la reprise', 'alertes/r.pdf', 'application/pdf', null);
  pr := siege_creer_alerte('prolongation', 'Sauce barbecue', null, 'L9', current_date + 2, current_date + 60, true, null, 'alertes/p.jpg', 'image/jpeg',
    array['00000000-0000-0000-0000-000000000001']::uuid[]);
  assert (select count(*) from notifications where ref_table = 'alertes_produit' and niveau = 1 and site_id = '00000000-0000-0000-0000-000000000002') = 1,
    'BOSTON prévenu du retrait seulement';
  begin
    insert into reponses_alerte (id, alerte_id, site_id, trouve, lot, quantite, photo, action, photo_action, par)
    values (gen_random_uuid(), r, '00000000-0000-0000-0000-000000000001', true, 'L2611A', '2 sacs', 'a.webp', 'reetiquete', 'b.webp', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : retrait « réétiqueté » accepté';
  exception when invalid_parameter_value then null; end;
  begin
    insert into reponses_alerte (id, alerte_id, site_id, trouve, lot, par)
    values (gen_random_uuid(), r, '00000000-0000-0000-0000-000000000001', true, 'L2611A', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : lot trouvé sans photo ni action accepté';
  exception when check_violation then null; end;
  insert into reponses_alerte (id, alerte_id, site_id, trouve, lot, quantite, photo, action, photo_action, par)
  values (gen_random_uuid(), r, '00000000-0000-0000-0000-000000000001', true, 'L2611A', '2 sacs', 'a.webp', 'isole', 'b.webp', '00000000-0000-0000-0000-0000000000a1');
  update alertes_produit set cree_at = now() - interval '5 hours' where id = r;
  n := relancer_alertes_produit();
  assert exists (select 1 from notifications where niveau = 2 and destinataire = 'siege' and site_id = '00000000-0000-0000-0000-000000000002'
    and titre like 'Sans réponse : retrait%'), 'relance au siège pour BOSTON sans réponse';
  assert not exists (select 1 from notifications where niveau = 2 and ref_table = 'alertes_produit' and site_id = '00000000-0000-0000-0000-000000000001'),
    'pas de relance pour DALLAS qui a répondu';
  assert relancer_alertes_produit() = 0, 'relance une seule fois';
  assert n >= 1 and not exists (select 1 from notifications where niveau = 2 and ref_id = md5(pr::text || '00000000-0000-0000-0000-000000000001')::uuid),
    'prolongation : pas encore de relance (24 h)';
  j := alertes_siege();
  assert (select s->'reponses'->0->>'lot' from jsonb_array_elements(j) x, jsonb_array_elements(x->'sites') s
          where x->>'id' = r::text and s->>'restaurant' = 'DALLAS') = 'L2611A', 'réponse de DALLAS visible au siège';
  assert (select jsonb_array_length(x->'sites') from jsonb_array_elements(j) x where x->>'id' = pr::text) = 1, 'prolongation : DALLAS seul';
end $$;
update auth.claims set jwt = '{"app_metadata":{"role":"siege"}}';

-- plan de nettoyage : tâches par zone, éléments cochés, photo obligatoire, tâche terminée
update auth.claims set jwt = '{"sub":"00000000-0000-0000-0000-0000000000c1","app_metadata":{"role":"siege"}}';
do $$ declare n int; t taches; e1 uuid; e2 uuid; e3 uuid; hotte uuid; j jsonb; begin
  update nettoyage_elements set actif = true where frequence = 'jour' and zone = 'Plonge';
  n := generer_nettoyages('2026-11-23');
  assert n = (select count(*) from sites where actif), 'une tâche Plonge par restaurant actif';
  assert generer_nettoyages('2026-11-23') = 0, 'pas de doublon de tâche de nettoyage';
  select * into t from taches where zone = 'Plonge' and site_id = '00000000-0000-0000-0000-000000000001' and jour = '2026-11-23';
  assert t.type = 'nettoyage' and t.titre = 'Nettoyage plonge' and cardinality(t.elements) = 3, 'tâche Plonge : 3 éléments';
  assert t.echeance = ('2026-11-23 23:30'::timestamp at time zone 'Europe/Paris'), 'échéance à l''heure du plan';
  update nettoyage_elements set actif = true where element = 'Détartrage du lave-vaisselle';
  assert (select count(*) from nettoyage_prevu('00000000-0000-0000-0000-000000000001', '2026-11-29')) = 4, 'dimanche : détartrage en plus';
  assert (select count(*) from nettoyage_prevu('00000000-0000-0000-0000-000000000001', '2026-11-23')) = 3, 'lundi : pas de détartrage';
  update nettoyage_elements set sites = array['00000000-0000-0000-0000-000000000002']::uuid[] where element = 'Détartrage du lave-vaisselle';
  assert (select count(*) from nettoyage_prevu('00000000-0000-0000-0000-000000000001', '2026-11-29')) = 3, 'élément réservé à BOSTON';
  assert (select count(*) from nettoyage_prevu('00000000-0000-0000-0000-000000000002', '2026-11-29')) = 4, 'BOSTON a le détartrage';
  update nettoyage_elements set actif = true where element = 'Hotte et filtres';
  assert (select count(*) from nettoyage_prevu('00000000-0000-0000-0000-000000000001', '2026-11-27')) = 4, 'vendredi : hotte';
  begin
    insert into nettoyage_elements (zone, element, frequence, jour) values ('Cuisine', 'Four', 'mois', 31);
    raise exception 'ÉCHEC : 31 du mois accepté';
  exception when check_violation then null; end;
  select id into e1 from nettoyage_elements where element = 'Bacs de plonge et égouttoirs';
  select id into e2 from nettoyage_elements where element = 'Lave-vaisselle : vidange et filtres';
  select id into e3 from nettoyage_elements where element = 'Sol de la plonge';
  select id into hotte from nettoyage_elements where element = 'Hotte et filtres';
  insert into nettoyages_faits (id, site_id, tache_id, element_id, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', t.id, e1, '00000000-0000-0000-0000-0000000000a1');
  begin
    insert into nettoyages_faits (id, site_id, tache_id, element_id, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', t.id, e2, '00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : élément sans la photo obligatoire accepté';
  exception when check_violation then null; end;
  begin
    insert into nettoyages_faits (id, site_id, tache_id, element_id, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', t.id, hotte, '00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : élément hors de la tâche accepté';
  exception when foreign_key_violation then null; end;
  begin
    insert into nettoyages_faits (id, site_id, tache_id, element_id, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', t.id, e3, '00000000-0000-0000-0000-0000000000a2');
    raise exception 'ÉCHEC : employé d''un autre restaurant accepté';
  exception when insufficient_privilege then null; end;
  insert into nettoyages_faits (id, site_id, tache_id, element_id, photo, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', t.id, e2, '00000000-0000-0000-0000-000000000001/x.webp', '00000000-0000-0000-0000-0000000000a1');
  assert (select faite_at from taches where id = t.id) is null, 'tâche pas finie tant qu''il reste un élément';
  insert into nettoyages_faits (id, site_id, tache_id, element_id, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', t.id, e3, '00000000-0000-0000-0000-0000000000a1');
  assert (select faite_at is not null and faite_par = '00000000-0000-0000-0000-0000000000a1' from taches where id = t.id), 'tâche terminée au dernier élément';
  j := nettoyage_tache(t.id);
  assert jsonb_array_length(j) = 3 and (select bool_and(x->'fait' is not null and x->'fait' <> 'null'::jsonb) from jsonb_array_elements(j) x), 'détail : 3 éléments faits';
  assert j->1->>'element' = 'Lave-vaisselle : vidange et filtres' and j->1->'produit' = 'null'::jsonb, 'ordre du plan, sans produit';
  assert j->0->'produit'->>'nom' = 'Détergent désinfectant surfaces', 'produit d''entretien joint';
  j := nettoyage_siege('2026-11-23');
  assert (select (x->'taches'->0->>'faits')::int = 3 and jsonb_array_length(x->'taches'->0->'photos') = 1 from jsonb_array_elements(j) x where x->>'restaurant' = 'DALLAS'), 'suivi siège DALLAS';
  assert (select (x->'taches'->0->>'faits')::int from jsonb_array_elements(j) x where x->>'restaurant' = 'BOSTON') = 0, 'suivi siège BOSTON';
end $$;
update auth.claims set jwt = '{"app_metadata":{"role":"siege"}}';

-- PMS : plan d'action, contrôles périodiques, métrologie
insert into profils(id,site_id,nom,role,pin_hash) values ('00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-000000000002','Tom','equipe',crypt('5151',gen_salt('bf')));
insert into anomalies(id,site_id,source,categorie,gravite,titre) values ('00000000-0000-0000-0000-0000000000c6','00000000-0000-0000-0000-000000000002','manuel','x','mineure','Porte réserve');
insert into profils(id,site_id,nom,role,pin_hash) values ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-000000000001','Marc','responsable',crypt('4444',gen_salt('bf')));
update auth.claims set jwt = '{"sub":"00000000-0000-0000-0000-0000000000c1","app_metadata":{"role":"siege"}}';
do $$ declare m uuid; c uuid; an uuid; ap uuid; j jsonb; v_auj date := (now() at time zone 'Europe/Paris')::date; begin
  -- contrôle conforme : à jour, prochaine date = +3 mois
  select id into m from controles_modeles where titre like 'Nettoyage des condenseurs%';
  begin
    insert into controles_faits (id, site_id, modele_id, date_realisation, conforme, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', m, v_auj, true, '00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : contrôle sans la photo obligatoire accepté';
  exception when check_violation then null; end;
  insert into controles_faits (id, site_id, modele_id, date_realisation, conforme, photo, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', m, v_auj - 100, true, '00000000-0000-0000-0000-000000000001/c.webp', '00000000-0000-0000-0000-0000000000a1');
  j := etat_controles('00000000-0000-0000-0000-000000000001');
  assert (select x->>'etat' from jsonb_array_elements(j) x where x->>'id' = m::text) = 'retard', 'fait il y a 100 jours, tous les 3 mois : en retard';
  assert (select x->>'etat' from jsonb_array_elements(j) x where x->>'titre' like 'Moustiquaires%') = 'jamais', 'jamais fait';
  insert into controles_faits (id, site_id, modele_id, date_realisation, conforme, photo, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', m, v_auj, true, '00000000-0000-0000-0000-000000000001/c2.webp', '00000000-0000-0000-0000-0000000000a1');
  j := etat_controles('00000000-0000-0000-0000-000000000001');
  assert (select x->>'etat' = 'a_jour' and (x->>'prochaine')::date = (v_auj + interval '3 months')::date from jsonb_array_elements(j) x where x->>'id' = m::text), 'à jour, prochaine dans 3 mois';
  begin
    insert into controles_faits (id, site_id, modele_id, date_realisation, conforme, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', m, v_auj + 2, true, '00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : date future acceptée';
  exception when invalid_parameter_value then null; end;
  -- non conforme : explication + photo obligatoires, une action est créée
  select id into m from controles_modeles where titre like 'Joints des portes%';
  begin
    insert into controles_faits (id, site_id, modele_id, date_realisation, conforme, photo, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', m, v_auj, false, '00000000-0000-0000-0000-000000000001/j.webp', '00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : non conforme sans explication accepté';
  exception when check_violation then null; end;
  c := gen_random_uuid();
  insert into controles_faits (id, site_id, modele_id, date_realisation, conforme, observation, photo, par) values (c, '00000000-0000-0000-0000-000000000001', m, v_auj, false, 'Joint CF positive déchiré', '00000000-0000-0000-0000-000000000001/j.webp', '00000000-0000-0000-0000-0000000000a1');
  select id into an from anomalies where source = 'controle' and ref_id = c;
  assert an is not null and (select titre from anomalies where id = an) = 'Joints des portes des enceintes froides : Joint CF positive déchiré', 'action créée';
  assert (select gravite from anomalies where id = an) = 'majeure', 'action majeure';
  -- plan d'action : prévoir, l'équipier ne peut pas
  begin
    perform planifier_action(an, '00000000-0000-0000-0000-0000000000a1', 'x', v_auj + 7, null);
    raise exception 'ÉCHEC : action vide acceptée';
  exception when invalid_parameter_value then null; end;
  perform planifier_action(an, '00000000-0000-0000-0000-0000000000a1', 'Commander et poser un joint neuf', v_auj + 7, '00000000-0000-0000-0000-0000000000a4');
  j := plan_action('00000000-0000-0000-0000-000000000001');
  assert (select x->>'responsable' = 'Marc' and x->>'action_prevue' = 'Commander et poser un joint neuf' from jsonb_array_elements(j) x where x->>'id' = an::text), 'action prévue visible';
  -- correction avec preuve ; majeure : le responsable ne peut pas clore, le siège oui
  begin
    perform traiter_action(an, '00000000-0000-0000-0000-0000000000a3', 'Joint posé', '00000000-0000-0000-0000-000000000002/x.webp');
    raise exception 'ÉCHEC : preuve d''un autre restaurant acceptée';
  exception when invalid_parameter_value then null; end;
  perform traiter_action(an, '00000000-0000-0000-0000-0000000000a3', 'Joint posé', '00000000-0000-0000-0000-000000000001/preuve.webp');
  assert (select statut = 'traitee' and preuve = '00000000-0000-0000-0000-000000000001/preuve.webp' from anomalies where id = an), 'traitée avec preuve';
  begin
    perform changer_statut_anomalie(an, 'verifiee', '00000000-0000-0000-0000-0000000000a4');
    raise exception 'ÉCHEC : le responsable clôt une action majeure';
  exception when insufficient_privilege then null; end;
  perform siege_changer_statut(an, 'verifiee');
  assert (select statut from anomalies where id = an) = 'verifiee', 'close par le siège';
  -- mineure : le responsable la clôt seul
  insert into anomalies (id, site_id, source, categorie, gravite, titre) values ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-000000000001', 'manuel', 'Matériel', 'mineure', 'Ampoule grillée');
  perform traiter_action('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000a3', 'Changée', null);
  perform changer_statut_anomalie('00000000-0000-0000-0000-0000000000c7', 'verifiee', '00000000-0000-0000-0000-0000000000a4');
  assert (select statut from anomalies where id = '00000000-0000-0000-0000-0000000000c7') = 'verifiee', 'mineure close par le responsable';
  -- relance : échéance passée → responsable, une seule fois
  insert into anomalies (id, site_id, source, categorie, gravite, titre, action_prevue, echeance) values ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-000000000001', 'manuel', 'x', 'majeure', 'Siphon bouché', 'Déboucher', v_auj - 2);
  insert into controles_faits (id, site_id, modele_id, date_realisation, conforme, par)
  select gen_random_uuid(), '00000000-0000-0000-0000-000000000001', id, v_auj - 40, true, '00000000-0000-0000-0000-0000000000a1' from controles_modeles where titre = 'Moustiquaires';
  perform relancer_pms();
  assert (select count(*) from notifications where ref_id = '00000000-0000-0000-0000-0000000000c8' and destinataire = 'responsable') = 1, 'action en retard relancée';
  assert exists (select 1 from notifications where ref_table = 'controles_modeles' and site_id = '00000000-0000-0000-0000-000000000001'), 'contrôle en retard relancé';
  perform relancer_pms();
  assert (select count(*) from notifications where ref_id = '00000000-0000-0000-0000-0000000000c8') = 1, 'relancée une seule fois';
  perform planifier_action('00000000-0000-0000-0000-0000000000c8', null, 'Faire passer le plombier', v_auj + 3, null);
  assert (select echeance = v_auj + 3 and not echeance_relancee from anomalies where id = '00000000-0000-0000-0000-0000000000c8'), 'le siège replanifie : relance réarmée';
  -- siège : contrôle par prestataire avec PDF
  select id into m from controles_modeles where titre like 'Passage du prestataire%';
  perform siege_enregistrer_controle('00000000-0000-0000-0000-000000000002', m, v_auj - 3, true, null, 'Rentokil', 'documents/rapport.pdf');
  assert (select x->'dernier'->>'prestataire' from jsonb_array_elements(etat_controles('00000000-0000-0000-0000-000000000002')) x where x->>'id' = m::text) = 'Rentokil', 'rapport du prestataire';
  begin
    perform siege_enregistrer_controle('00000000-0000-0000-0000-000000000002', m, v_auj, true, null, null, '00000000-0000-0000-0000-000000000001/x.pdf');
    raise exception 'ÉCHEC : rapport rangé chez un autre restaurant accepté';
  exception when invalid_parameter_value then null; end;
  -- métrologie : glace fondante, tolérance 0,5 °C calculée par le serveur
  insert into appareils_mesure (id, site_id, nom) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'Sonde piquante 1');
  insert into verifications_mesure (id, site_id, appareil_id, methode, valeur, conforme, photo, par)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'glace', 0.4, false, '00000000-0000-0000-0000-000000000001/g.webp', '00000000-0000-0000-0000-0000000000a1');
  assert (select x->>'etat' from jsonb_array_elements(etat_metrologie('00000000-0000-0000-0000-000000000001')) x) = 'a_jour', '0,4 °C : conforme (calcul serveur)';
  insert into verifications_mesure (id, site_id, appareil_id, methode, valeur, conforme, photo, par)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'glace', 1.2, true, '00000000-0000-0000-0000-000000000001/g2.webp', '00000000-0000-0000-0000-0000000000a1');
  assert (select x->>'etat' from jsonb_array_elements(etat_metrologie('00000000-0000-0000-0000-000000000001')) x) = 'hors_service', '1,2 °C : hors service malgré « conforme » envoyé';
  assert exists (select 1 from anomalies where source = 'metrologie' and titre = 'Appareil hors tolérance : Sonde piquante 1 (lu 1.2 °C au lieu de 0)'), 'action métrologie';
  begin
    insert into verifications_mesure (id, site_id, appareil_id, methode, valeur, conforme, par)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'ebullition', 99.5, true, '00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : vérification sans photo acceptée';
  exception when check_violation then null; end;
  insert into verifications_mesure (id, site_id, appareil_id, methode, valeur, conforme, photo, par)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'ebullition', 99.5, false, '00000000-0000-0000-0000-000000000001/e.webp', '00000000-0000-0000-0000-0000000000a1');
  assert (select not hors_service from appareils_mesure where id = '00000000-0000-0000-0000-0000000000b1'), 'remis en service après une vérification conforme';
  -- choix B : écart majeur du quotidien clos par le responsable ; critique toujours par le siège
  insert into anomalies (id, site_id, source, categorie, gravite, titre) values ('00000000-0000-0000-0000-000000009e01', '00000000-0000-0000-0000-000000000001', 'tache', 'Tâche', 'majeure', 'Relevé oublié');
  perform traiter_action('00000000-0000-0000-0000-000000009e01', '00000000-0000-0000-0000-0000000000a3', 'Fait en retard', null);
  perform changer_statut_anomalie('00000000-0000-0000-0000-000000009e01', 'verifiee', '00000000-0000-0000-0000-0000000000a4');
  assert (select statut from anomalies where id = '00000000-0000-0000-0000-000000009e01') = 'verifiee', 'majeure du quotidien close par le responsable';
  insert into anomalies (id, site_id, source, categorie, gravite, titre) values ('00000000-0000-0000-0000-000000009e02', '00000000-0000-0000-0000-000000000001', 'releve', 'T°', 'critique', 'Chambre froide à 12 °C');
  perform traiter_action('00000000-0000-0000-0000-000000009e02', '00000000-0000-0000-0000-0000000000a3', 'Produits jetés', null);
  begin
    perform changer_statut_anomalie('00000000-0000-0000-0000-000000009e02', 'verifiee', '00000000-0000-0000-0000-0000000000a4');
    raise exception 'ÉCHEC : action critique close par le responsable';
  exception when insufficient_privilege then null; end;
  -- visites : Eurofins avec écarts et analyses ; renvoi sans doublon ; résultats ajoutés plus tard
  perform enregistrer_visite(jsonb_build_object('id', '00000000-0000-0000-0000-0000000000e1', 'site_id', '00000000-0000-0000-0000-000000000001', 'type', 'eurofins',
    'date_visite', v_auj - 70, 'organisme', 'Eurofins', 'note', 82.5, 'niveau', 'satisfaisant', 'rapport', 'documents/eurofins.pdf',
    'ecarts', jsonb_build_array(jsonb_build_object('texte', 'Thermomètre de la CF négative absent', 'gravite', 'majeure'), jsonb_build_object('texte', 'x')),
    'analyses', jsonb_build_array(jsonb_build_object('id', '00000000-0000-0000-0000-0000000000f1', 'categorie', 'surface', 'objet', 'Plan de travail froid', 'resultat', 'satisfaisant'),
                                  jsonb_build_object('id', '00000000-0000-0000-0000-0000000000f2', 'categorie', 'produit', 'objet', 'Coleslaw', 'resultat', 'non_satisfaisant', 'detail', 'Listeria détectée'))));
  perform enregistrer_visite(jsonb_build_object('id', '00000000-0000-0000-0000-0000000000e1', 'site_id', '00000000-0000-0000-0000-000000000001', 'type', 'eurofins', 'date_visite', v_auj - 70));
  assert (select count(*) from visites) = 1, 'renvoi sans doublon';
  assert (select count(*) from anomalies where source = 'visite' and ref_id = '00000000-0000-0000-0000-0000000000e1') = 1, 'un écart (le trop court est ignoré)';
  assert (select titre from anomalies where source = 'analyse') = 'Analyse non satisfaisante : Coleslaw (Listeria détectée)', 'analyse non satisfaisante : action';
  j := etat_visites('00000000-0000-0000-0000-000000000001');
  assert j->>'etat_eurofins' = 'retard' and (j->>'prochaine_eurofins')::date = (v_auj - 70 + interval '2 months')::date, 'Eurofins tous les 2 mois : en retard';
  assert jsonb_array_length(j->'visites'->0->'analyses') = 2 and jsonb_array_length(j->'visites'->0->'ecarts') = 1, 'visite détaillée';
  assert ajouter_analyses('00000000-0000-0000-0000-0000000000e1', null, jsonb_build_array(
    jsonb_build_object('id', '00000000-0000-0000-0000-0000000000f2', 'categorie', 'produit', 'objet', 'Coleslaw', 'resultat', 'non_satisfaisant'),
    jsonb_build_object('id', '00000000-0000-0000-0000-0000000000f3', 'categorie', 'eau', 'objet', 'Eau du robinet cuisine', 'resultat', 'acceptable')), 'documents/analyses.pdf') = 1,
    'résultats ajoutés plus tard, sans doublon';
  assert (select count(*) from anomalies where source = 'analyse') = 1, 'pas de seconde action pour la même analyse';
  assert relancer_visites() = 1 and relancer_visites() = 0, 'relance Eurofins au siège, une fois';
  begin
    perform enregistrer_visite(jsonb_build_object('id', gen_random_uuid(), 'site_id', '00000000-0000-0000-0000-000000000001', 'type', 'officielle', 'date_visite', v_auj + 1));
    raise exception 'ÉCHEC : visite future acceptée';
  exception when invalid_parameter_value then null; end;
  begin
    perform enregistrer_visite(jsonb_build_object('id', gen_random_uuid(), 'site_id', '00000000-0000-0000-0000-000000000001', 'type', 'officielle', 'date_visite', v_auj, 'rapport', '00000000-0000-0000-0000-000000000002/x.pdf'));
    raise exception 'ÉCHEC : rapport d''un autre restaurant accepté';
  exception when invalid_parameter_value then null; end;
  perform enregistrer_visite(jsonb_build_object('id', '00000000-0000-0000-0000-0000000000e2', 'site_id', '00000000-0000-0000-0000-000000000001', 'type', 'eurofins', 'date_visite', v_auj - 5, 'note', 91));
  assert etat_visites('00000000-0000-0000-0000-000000000001')->>'etat_eurofins' = 'a_jour', 'nouvelle visite : à jour';
  -- documents : groupe (siège) + restaurant, remplacement archivé, liste des attendus, expiration
  perform enregistrer_document(jsonb_build_object('id', '00000000-0000-0000-0000-00000000d001', 'site_id', null, 'type_cle', 'plan_haccp',
    'titre', 'Plan HACCP groupe 2026', 'fichier', 'documents/haccp.pdf'));
  perform enregistrer_document(jsonb_build_object('id', '00000000-0000-0000-0000-00000000d002', 'site_id', '00000000-0000-0000-0000-000000000001', 'type_cle', 'contrat_3d',
    'titre', 'Contrat Rentokil', 'fichier', 'documents/3d.pdf', 'expire_le', v_auj + 10));
  perform enregistrer_document(jsonb_build_object('id', '00000000-0000-0000-0000-00000000d002', 'site_id', '00000000-0000-0000-0000-000000000001', 'type_cle', 'contrat_3d',
    'titre', 'doublon', 'fichier', 'documents/3d.pdf'));
  assert (select count(*) from documents_pms) = 2, 'renvoi sans doublon';
  j := documents_site('00000000-0000-0000-0000-000000000001');
  assert jsonb_array_length(j->'documents') = 2, 'DALLAS voit le document du groupe et le sien';
  assert (select x->>'etat' from jsonb_array_elements(j->'documents') x where x->>'type_cle' = 'contrat_3d') = 'bientot', 'expire dans 10 jours : bientôt';
  assert (select (x->>'present')::boolean from jsonb_array_elements(j->'attendus') x where x->>'cle' = 'plan_haccp'), 'plan HACCP présent (groupe)';
  assert not (select (x->>'present')::boolean from jsonb_array_elements(j->'attendus') x where x->>'cle' = 'formation_hygiene'), 'attestation manquante';
  assert relancer_documents() = 1 and relancer_documents() = 0, 'rappel avant expiration, une fois';
  perform enregistrer_document(jsonb_build_object('id', '00000000-0000-0000-0000-00000000d003', 'site_id', '00000000-0000-0000-0000-000000000001', 'type_cle', 'contrat_3d',
    'titre', 'Contrat Rentokil 2027', 'fichier', 'documents/3d-2027.pdf', 'expire_le', v_auj + 400, 'remplace', '00000000-0000-0000-0000-00000000d002'));
  assert (select not actif and archive_at is not null from documents_pms where id = '00000000-0000-0000-0000-00000000d002'), 'ancien contrat archivé';
  assert jsonb_array_length(documents_archives('00000000-0000-0000-0000-000000000001')) = 1, 'archives consultables';
  begin
    perform enregistrer_document(jsonb_build_object('id', gen_random_uuid(), 'site_id', '00000000-0000-0000-0000-000000000001', 'type_cle', 'plan_appats', 'titre', 'Plan', 'fichier', '00000000-0000-0000-0000-000000000002/x.pdf'));
    raise exception 'ÉCHEC : fichier d''un autre restaurant accepté';
  exception when invalid_parameter_value then null; end;
  begin
    perform enregistrer_document(jsonb_build_object('id', gen_random_uuid(), 'site_id', '00000000-0000-0000-0000-000000000002', 'type_cle', 'contrat_3d', 'titre', 'Mauvais',
      'fichier', 'documents/z.pdf', 'remplace', '00000000-0000-0000-0000-00000000d003'));
    raise exception 'ÉCHEC : remplacement d''un document d''un autre restaurant accepté';
  exception when invalid_parameter_value then null; end;
  assert (select (x->>'manquants')::int > 0 from jsonb_array_elements(documents_groupe()) x where x->>'site_id' = '00000000-0000-0000-0000-000000000001'), 'vue groupe : manquants';
  j := pms_groupe();
  assert (select (x->>'actions_ouvertes')::int >= 1 from jsonb_array_elements(j) x where x->>'restaurant' = 'DALLAS'), 'vue groupe';
end $$;
update auth.claims set jwt = '{"app_metadata":{"role":"siege"}}';

-- règles d'accès : une tablette ne voit que son site
create role tablette in role authenticated; grant usage on schema public, auth to tablette; grant select, insert, update on all tables in schema public to tablette;
grant select on auth.claims to tablette; grant execute on all functions in schema auth to tablette;
update auth.claims set jwt = '{"app_metadata":{"role":"tablette","site_id":"00000000-0000-0000-0000-000000000002"}}';
set role tablette;
do $$ declare p uuid; r record; begin
  select id into p from produits_retires where nom = 'Sauce cheddar ancienne recette';
  select * into r from stocks_morts_du_site() where produit_id = p;
  assert r.etat = 'a_verifier' and r.a_faire, 'BOSTON : à vérifier, à faire';
  assert (select count(*) from inventaires_stock) = 0, 'BOSTON ne voit pas les inventaires de DALLAS';
  insert into inventaires_stock (id, produit_id, site_id, reste, par) values (gen_random_uuid(), p, '00000000-0000-0000-0000-000000000002', false, '00000000-0000-0000-0000-0000000000a2');
  select * into r from stocks_morts_du_site() where produit_id = p;
  assert r.etat = 'solde' and not r.a_faire, 'BOSTON : plus rien, soldé';
  begin
    insert into inventaires_stock (id, produit_id, site_id, reste, par) values (gen_random_uuid(), p, '00000000-0000-0000-0000-000000000001', false, '00000000-0000-0000-0000-0000000000a2');
    raise exception 'ÉCHEC : inventaire pour un autre site accepté';
  exception when insufficient_privilege then null; end;
  begin
    perform planifier_action('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000a5', 'Régler la porte', (now() at time zone 'Europe/Paris')::date + 2, null);
    raise exception 'ÉCHEC : un équipier planifie une action';
  exception when insufficient_privilege then null; end;
  perform planifier_action('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000a2', 'Régler la porte', (now() at time zone 'Europe/Paris')::date + 2, '00000000-0000-0000-0000-0000000000a5');
  assert (select x->>'responsable' from jsonb_array_elements(plan_action('00000000-0000-0000-0000-000000000002')) x where x->>'id' = '00000000-0000-0000-0000-0000000000c6') = 'Tom', 'le chef de BOSTON planifie';
  begin
    perform planifier_action('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000a2', 'x x x', (now() at time zone 'Europe/Paris')::date + 2, null);
    raise exception 'ÉCHEC : BOSTON planifie une action de DALLAS';
  exception when no_data_found then null; end;
  -- documents : BOSTON voit le document du groupe, pas ceux de DALLAS ; il dépose le sien, pas un document du groupe
  assert (select count(*) from documents_pms) = 1, 'BOSTON : seul le document du groupe est visible';
  assert jsonb_array_length(documents_site('00000000-0000-0000-0000-000000000002')->'documents') = 1, 'classeur BOSTON';
  perform enregistrer_document(jsonb_build_object('id', gen_random_uuid(), 'type_cle', 'formation_hygiene', 'titre', 'Attestation Léa',
    'personne', 'Léa', 'fichier', '00000000-0000-0000-0000-000000000002/att.pdf', 'profil', '00000000-0000-0000-0000-0000000000a2'));
  assert jsonb_array_length(documents_site('00000000-0000-0000-0000-000000000002')->'documents') = 2, 'BOSTON dépose son attestation';
  begin
    perform archiver_document('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000a2');
    raise exception 'ÉCHEC : une tablette retire un document du groupe';
  exception when insufficient_privilege then null; end;
  begin
    perform documents_site('00000000-0000-0000-0000-000000000001');
    raise exception 'ÉCHEC : BOSTON lit le classeur de DALLAS';
  exception when insufficient_privilege then null; end;
  -- visites : BOSTON ne voit pas celles de DALLAS ; le chef enregistre la sienne, l'équipier non
  assert (select count(*) from visites) = 0 and (select count(*) from analyses) = 0, 'visites de DALLAS invisibles';
  begin
    perform etat_visites('00000000-0000-0000-0000-000000000001');
    raise exception 'ÉCHEC : BOSTON lit les visites de DALLAS';
  exception when insufficient_privilege then null; end;
  begin
    perform enregistrer_visite(jsonb_build_object('id', gen_random_uuid(), 'type', 'officielle', 'date_visite', (now() at time zone 'Europe/Paris')::date, 'profil', '00000000-0000-0000-0000-0000000000a5'));
    raise exception 'ÉCHEC : un équipier enregistre une visite';
  exception when insufficient_privilege then null; end;
  perform enregistrer_visite(jsonb_build_object('id', gen_random_uuid(), 'type', 'officielle', 'date_visite', (now() at time zone 'Europe/Paris')::date,
    'organisme', 'DDPP', 'niveau', 'satisfaisant', 'profil', '00000000-0000-0000-0000-0000000000a2', 'rapport', '00000000-0000-0000-0000-000000000002/rapport.webp'));
  assert (select count(*) from visites) = 1, 'BOSTON enregistre sa visite officielle';
  begin
    perform ajouter_analyses('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', '[]'::jsonb);
    raise exception 'ÉCHEC : BOSTON complète une visite de DALLAS';
  exception when no_data_found then null; end;
  -- PMS : BOSTON ne voit pas les contrôles ni le plan d'action de DALLAS
  begin
    perform etat_controles('00000000-0000-0000-0000-000000000001');
    raise exception 'ÉCHEC : BOSTON lit les contrôles de DALLAS';
  exception when insufficient_privilege then null; end;
  begin
    perform plan_action('00000000-0000-0000-0000-000000000001');
    raise exception 'ÉCHEC : BOSTON lit le plan d''action de DALLAS';
  exception when insufficient_privilege then null; end;
  assert jsonb_typeof(etat_controles('00000000-0000-0000-0000-000000000002')) = 'array', 'BOSTON lit ses contrôles';
  assert (select count(*) from controles_faits where site_id = '00000000-0000-0000-0000-000000000001') = 0, 'contrôles de DALLAS invisibles';
  assert (select count(*) from appareils_mesure) = 0, 'appareils de DALLAS invisibles';
  begin
    perform ajouter_appareil('00000000-0000-0000-0000-0000000000a1', 'Sonde pirate', 'sonde', null);
    raise exception 'ÉCHEC : appareil ajouté par une personne d''un autre site';
  exception when insufficient_privilege then null; end;
  perform ajouter_appareil('00000000-0000-0000-0000-0000000000a2', 'Sonde 1', 'sonde', 'SN-1');
  assert (select count(*) from appareils_mesure) = 1, 'BOSTON ajoute sa sonde';
  begin
    perform pms_groupe();
    raise exception 'ÉCHEC : une tablette lit la vue groupe';
  exception when insufficient_privilege then null; end;
  -- nettoyage : BOSTON ne voit ni ne coche la tâche de DALLAS ; il voit le plan et les produits
  assert jsonb_array_length(nettoyage_tache((select id from taches where zone = 'Plonge' and site_id = '00000000-0000-0000-0000-000000000001' limit 1))) = 0, 'BOSTON ne voit pas le nettoyage de DALLAS';
  assert (select count(*) from nettoyages_faits) = 0, 'BOSTON ne voit pas les nettoyages de DALLAS';
  assert (select count(*) from produits_entretien) = 6, 'fiches produits lisibles';
  assert jsonb_typeof(nettoyage_du_jour()) = 'array', 'nettoyage du jour lisible';
  begin
    insert into produits_entretien (nom) values ('Pirate');
    raise exception 'ÉCHEC : une tablette ajoute un produit d''entretien';
  exception when insufficient_privilege then null; end;
  begin
    update nettoyage_elements set photo_obligatoire = false where photo_obligatoire;
    assert not found or (select bool_and(photo_obligatoire) from nettoyage_elements where element = 'Hotte et filtres'), 'plan non modifiable';
  end;
  -- alertes produit : BOSTON voit le retrait (tous les restaurants), pas la prolongation réservée à DALLAS
  assert (select count(*) from jsonb_array_elements(alertes_du_site())) = 1, 'BOSTON : une alerte';
  assert (select x->>'produit' from jsonb_array_elements(alertes_du_site()) x) = 'Cheddar tranché', 'BOSTON : le retrait';
  assert (select count(*) from reponses_alerte) = 0, 'BOSTON ne voit pas les réponses de DALLAS';
  insert into reponses_alerte (id, alerte_id, site_id, trouve, par)
  select gen_random_uuid(), (x->>'id')::uuid, '00000000-0000-0000-0000-000000000002', false, '00000000-0000-0000-0000-0000000000a2' from jsonb_array_elements(alertes_du_site()) x;
  assert (select jsonb_array_length(x->'reponses') from jsonb_array_elements(alertes_du_site()) x) = 1, 'BOSTON : réponse enregistrée';
  begin
    insert into reponses_alerte (id, alerte_id, site_id, trouve, par)
    select gen_random_uuid(), id, '00000000-0000-0000-0000-000000000002', false, '00000000-0000-0000-0000-0000000000a2' from alertes_produit where produit = 'Sauce barbecue';
    assert (select count(*) from alertes_produit where produit = 'Sauce barbecue') = 0, 'BOSTON ne voit pas l''alerte de DALLAS';
  end;
  begin
    perform siege_creer_alerte('retrait', 'Pirate', null, null, null, null, false, null, null, null, null);
    raise exception 'ÉCHEC : une tablette crée une alerte produit';
  exception when insufficient_privilege then null; end;
  begin
    perform siege_ajouter_employe('00000000-0000-0000-0000-000000000002', 'Intrus', 'chef');
    raise exception 'ÉCHEC : une tablette crée un employé';
  exception when insufficient_privilege then null; end;
  begin
    perform siege_retirer_produit('Produit pirate');
    raise exception 'ÉCHEC : une tablette déclare un produit retiré';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  assert (select count(*) from releves) = 0, 'BOSTON ne voit pas les relevés de DALLAS';
  assert (select count(*) from journal) = 0, 'le journal n''est pas lisible par une tablette';
  assert (select count(*) from taches where site_id <> '00000000-0000-0000-0000-000000000002') = 0, 'BOSTON ne voit pas les tâches de DALLAS';
  assert (select count(*) from profils_du_site()) = 2, 'BOSTON ne voit que ses employés (Lea, Tom)';
  assert not verifier_pin('00000000-0000-0000-0000-0000000000a1','1234'), 'PIN d''un autre site refusé';
  begin
    insert into releves(site_id,enceinte_id,valeur,t_max,par) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1',2,3,'00000000-0000-0000-0000-0000000000a2');
    raise exception 'ÉCHEC : écriture pour un autre site acceptée';
  exception when insufficient_privilege then null; end;

  -- durcissement : la tablette ne modifie pas une saisie existante, ne crée pas d'enceinte
  insert into releves(site_id,enceinte_id,valeur,t_max,par) values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000e2',2,3,'00000000-0000-0000-0000-0000000000a2');
  update releves set valeur = -5;
  assert (select valeur from releves) = 2, 'une tablette ne modifie pas un relevé envoyé';
  begin
    insert into enceintes(site_id,nom,t_max) values ('00000000-0000-0000-0000-000000000002','Frigo pirate',50);
    raise exception 'ÉCHEC : une tablette crée une enceinte';
  exception when insufficient_privilege then null; end;
  -- seuil imposé par le serveur : la tablette envoie t_max = 99 pour faire passer +8 °C
  begin
    insert into releves(site_id,enceinte_id,valeur,t_max,par) values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000e2',8,99,'00000000-0000-0000-0000-0000000000a2');
    raise exception 'ÉCHEC : seuil envoyé par la tablette accepté';
  exception when check_violation then null; end;
  -- personne d'un autre site
  begin
    insert into releves(site_id,enceinte_id,valeur,t_max,par) values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000e2',2,3,'00000000-0000-0000-0000-0000000000a1');
    raise exception 'ÉCHEC : relevé signé par une personne d''un autre site';
  exception when insufficient_privilege then null; end;
  -- anomalie créée « vérifiée » d'office : remise à « ouverte »
  insert into anomalies(id,site_id,source,categorie,gravite,titre,statut,cree_par) values ('00000000-0000-0000-0000-0000000000c9','00000000-0000-0000-0000-000000000002','manuel','x','mineure','x','verifiee','00000000-0000-0000-0000-0000000000a2');
end $$;
reset role;
do $$ begin
  assert (select statut from anomalies where id = '00000000-0000-0000-0000-0000000000c9') = 'ouverte', 'anomalie toujours créée ouverte';
end $$;
set role tablette;
do $$ declare i int; begin
  -- PIN : bloqué après 5 erreurs
  for i in 1..5 loop perform verifier_pin('00000000-0000-0000-0000-0000000000a2','0000'); end loop;
  begin
    perform verifier_pin('00000000-0000-0000-0000-0000000000a2','5555');
    raise exception 'ÉCHEC : PIN non bloqué après 5 erreurs';
  exception when raise_exception then
    if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    perform * from resume_jour();
    raise exception 'ÉCHEC : une tablette lit le résumé de tous les sites';
  exception when insufficient_privilege then null; end;
  begin
    perform escalader();
    raise exception 'ÉCHEC : une tablette lance les relances';
  exception when insufficient_privilege then null; end;
  begin
    perform * from tableau_siege(7);
    raise exception 'ÉCHEC : une tablette lit le tableau du siège';
  exception when insufficient_privilege then null; end;
  begin
    perform * from tableau_siege_v2(7);
    raise exception 'ÉCHEC : une tablette lit le tableau v2 du siège';
  exception when insufficient_privilege then null; end;
  begin
    perform siege_rattraper('releve', (select id from enceintes limit 1), now() - interval '1 hour', 3, 'Tentative tablette');
    raise exception 'ÉCHEC : une tablette fait un rattrapage siège';
  exception when insufficient_privilege then null; end;
  begin
    perform siege_corriger('releves', (select id from releves limit 1), 'Tentative tablette');
    raise exception 'ÉCHEC : une tablette corrige une saisie';
  exception when insufficient_privilege then null; end;
  begin
    perform * from etat_restaurants();
    raise exception 'ÉCHEC : une tablette lit l''état des restaurants';
  exception when insufficient_privilege then null; end;
  begin
    perform * from anomalies_siege();
    raise exception 'ÉCHEC : une tablette lit les anomalies du groupe';
  exception when insufficient_privilege then null; end;
  begin
    perform preuves_jour('00000000-0000-0000-0000-000000000001', current_date);
    raise exception 'ÉCHEC : une tablette lit les preuves d''un autre restaurant';
  exception when insufficient_privilege then null; end;
  begin
    perform siege_changer_statut('00000000-0000-0000-0000-0000000000d2', 'traitee', 'x');
    raise exception 'ÉCHEC : une tablette agit comme le siège';
  exception when insufficient_privilege then null; end;
  begin
    perform pin_hash from profils;
    assert (select count(*) from profils) = 0, 'les PIN ne sont pas lisibles';
  end;
end $$;
reset role;
-- revue de sécurité : génération des tâches, compte siège, heure et motif imposés, origines réservées, preuves non supprimables
insert into profils(id,site_id,nom,role,pin_hash) values ('00000000-0000-0000-0000-00000000c5e0', null, 'Siège test', 'siege', crypt('x', gen_salt('bf'))) on conflict do nothing;
insert into anomalies(id,site_id,source,categorie,gravite,titre) values ('00000000-0000-0000-0000-00000000c5e1','00000000-0000-0000-0000-000000000002','releve','T°','critique','CF à 12 °C');
update anomalies set statut = 'traitee' where id = '00000000-0000-0000-0000-00000000c5e1';
update auth.claims set jwt = '{"app_metadata":{"role":"tablette","site_id":"00000000-0000-0000-0000-000000000002"}}';
set role tablette;
do $$ declare n int; e uuid; r uuid := gen_random_uuid(); a uuid := gen_random_uuid(); begin
  perform generer_taches('2020-01-01');   -- ancienne app : ramené aux tâches du jour de son site
  assert not exists (select 1 from taches where jour = '2020-01-01'), 'une tablette ne génère pas les tâches d''un autre jour';
  n := generer_taches_du_site();
  assert not exists (select 1 from taches where jour = '2020-01-01'), 'aucune tâche à une date choisie';
  begin
    perform changer_statut_anomalie('00000000-0000-0000-0000-00000000c5e1', 'verifiee', '00000000-0000-0000-0000-00000000c5e0');
    raise exception 'ÉCHEC : une tablette clôt au nom du siège';
  exception when insufficient_privilege then null; end;
  select id into e from enceintes where site_id = '00000000-0000-0000-0000-000000000002' limit 1;
  begin
    insert into releves (id, site_id, enceinte_id, valeur, t_max, par) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000002', e, 3, 4, '00000000-0000-0000-0000-00000000c5e0');
    raise exception 'ÉCHEC : relevé signé par un compte siège depuis une tablette';
  exception when insufficient_privilege then null; end;
  insert into releves (id, site_id, enceinte_id, valeur, t_max, par, at, at_client, rattrapage_motif)
  values (r, '00000000-0000-0000-0000-000000000002', e, 3, 4, '00000000-0000-0000-0000-0000000000a2', '2026-01-01', now() + interval '2 days', 'faux motif');
  assert (select at > now() - interval '1 minute' and at_client is null and rattrapage_motif is null from releves where id = r),
    'heure de réception serveur, heure future écartée, motif de rattrapage refusé';
  insert into anomalies (id, site_id, source, ref_id, categorie, gravite, titre, echeance, action_prevue, cree_par)
  values (a, '00000000-0000-0000-0000-000000000002', 'tache', gen_random_uuid(), 'x', 'mineure', 'leurre', current_date + 30, 'rien', '00000000-0000-0000-0000-0000000000a2');
  assert (select source = 'manuel' and ref_id is null and echeance is null and action_prevue is null from anomalies where id = a),
    'origine automatique et plan d''action refusés à la tablette';
end $$;
reset role;
do $$ begin
  begin
    delete from visites;
    if exists (select 1 from visites) then raise exception 'ÉCHEC : visite supprimée'; end if;
  exception when raise_exception then
    if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  assert not has_function_privilege('anon', 'verifier_pin(uuid,text)', 'EXECUTE'), 'anon ne peut rien appeler';
  assert has_function_privilege('authenticated', 'verifier_pin(uuid,text)', 'EXECUTE'), 'les tablettes gardent leurs fonctions';
  assert not has_function_privilege('authenticated', 'escalader()', 'EXECUTE'), 'les fonctions internes restent fermées';
  assert (select count(distinct pin_aleatoire()) from generate_series(1, 50)) > 30, 'PIN variés';
end $$;
-- hors ligne : opérations rejouées, heure réelle jusqu'à 7 jours
update auth.claims set jwt = '{"app_metadata":{"role":"siege"}}';
do $$ declare l uuid := '00000000-0000-0000-0000-0000000000d1'; begin
  perform marquer_rangee(l, now());
  perform marquer_rangee(l, now());   -- renvoi : déjà rangée, pas d'erreur
  begin
    perform marquer_rangee(gen_random_uuid(), now());
    raise exception 'ÉCHEC : rangement d''une livraison inconnue ignoré sans erreur';
  exception when no_data_found then null; end;
  perform archiver_document('00000000-0000-0000-0000-00000000d003', null);
  perform archiver_document('00000000-0000-0000-0000-00000000d003', null);   -- renvoi : déjà retiré
  assert heure_effective(now(), now() - interval '3 days') = now() - interval '3 days', 'week-end hors ligne : heure réelle gardée';
  assert heure_effective(now(), now() - interval '8 days') = now(), 'au-delà de 7 jours : heure de réception';
end $$;
-- ancienne app : generer_taches(date) depuis une tablette = tâches de son site, aujourd'hui seulement
update auth.claims set jwt = '{"sub":"00000000-0000-0000-0000-00000000a0a0","app_metadata":{"site_id":"00000000-0000-0000-0000-000000000001","role":"tablette"}}';
do $$ declare avant int; begin
  select count(*) into avant from taches where site_id <> '00000000-0000-0000-0000-000000000001' or jour <> (now() at time zone 'Europe/Paris')::date;
  perform generer_taches(((now() at time zone 'Europe/Paris')::date + 3));
  assert (select count(*) from taches where site_id <> '00000000-0000-0000-0000-000000000001' or jour <> (now() at time zone 'Europe/Paris')::date) = avant,
    'tablette : rien créé pour un autre jour ni un autre site';
end $$;
-- correctif 0039 : écritures du serveur non bridées
-- tâche planifiée (pas de jeton) : une seule anomalie par tâche non faite, même lancée deux fois
update auth.claims set jwt = null;
do $$ declare t uuid := gen_random_uuid(); begin
  insert into taches (id, site_id, type, titre, jour, echeance) values (t, '00000000-0000-0000-0000-000000000001', 'autre', 'Test 0039', current_date - 2, now() - interval '2 days');
  insert into anomalies (site_id, source, ref_id, categorie, gravite, titre) values ('00000000-0000-0000-0000-000000000001', 'tache', t, 'Tâche non faite', 'majeure', 'Tâche non faite : Test 0039');
  assert (select source from anomalies where ref_id = t) = 'tache', 'tâche planifiée : origine gardée (doublons détectables)';
end $$;
-- fonction de l'app appelée par une tablette : origine gardée ; écriture directe : origine imposée
update auth.claims set jwt = '{"sub":"00000000-0000-0000-0000-00000000a0a0","app_metadata":{"site_id":"00000000-0000-0000-0000-000000000001","role":"tablette"}}';
do $$ declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); begin
  perform set_config('request.path', '/rpc/enregistrer_visite', true);
  insert into anomalies (id, site_id, source, ref_id, categorie, gravite, titre) values (a, '00000000-0000-0000-0000-000000000001', 'visite', gen_random_uuid(), 'x', 'majeure', 'via rpc');
  perform set_config('request.path', '/anomalies', true);
  insert into anomalies (id, site_id, source, ref_id, categorie, gravite, titre) values (b, '00000000-0000-0000-0000-000000000001', 'visite', gen_random_uuid(), 'x', 'majeure', 'directe');
  assert (select source from anomalies where id = a) = 'visite', 'rpc : origine gardée';
  assert (select source from anomalies where id = b) = 'manuel', 'écriture directe d''une tablette : origine imposée';
  perform set_config('request.path', '/rpc/graphql', true);
  insert into anomalies (id, site_id, source, ref_id, categorie, gravite, titre, statut) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'tache', gen_random_uuid(), 'x', 'majeure', 'via graphql', 'verifiee');
  assert (select source from anomalies where titre = 'via graphql') = 'manuel', 'GraphQL : contrôlé comme une écriture directe';
  assert (select statut from anomalies where titre = 'via graphql') = 'ouverte', 'GraphQL : une anomalie naît ouverte';
end $$;
\echo TOUS_LES_TESTS_SQL_OK
