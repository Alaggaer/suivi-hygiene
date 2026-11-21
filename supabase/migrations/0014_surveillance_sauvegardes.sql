-- Surveillance des sauvegardes : chaque sauvegarde réussie (GitHub) s'inscrit ici ; la base vérifie toutes les heures
-- et prévient le siège par e-mail si aucune sauvegarde n'a réussi depuis plus de 26 h. Indépendant de GitHub.
create table sauvegardes (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  comptes jsonb not null default '{}'::jsonb,
  origine text not null default 'github'
);
alter table sauvegardes enable row level security;
create policy lire on sauvegardes for select using (est_siege());

-- Dernière sauvegarde connue avant ce suivi (exécution planifiée du 21/11 au matin).
insert into sauvegardes (at, comptes, origine) values ('2026-11-21T10:01:00Z', '{"note":"avant surveillance"}', 'github');
