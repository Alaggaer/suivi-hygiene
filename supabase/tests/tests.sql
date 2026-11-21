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
    perform siege_retirer_produit('Produit pirate');
    raise exception 'ÉCHEC : une tablette déclare un produit retiré';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  assert (select count(*) from releves) = 0, 'BOSTON ne voit pas les relevés de DALLAS';
  assert (select count(*) from journal) = 0, 'le journal n''est pas lisible par une tablette';
  assert (select count(*) from taches) = 0, 'BOSTON ne voit pas les tâches de DALLAS';
  assert (select count(*) from profils_du_site()) = 1, 'BOSTON ne voit que ses employés';
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
\echo TOUS_LES_TESTS_SQL_OK
