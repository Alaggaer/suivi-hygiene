-- Ce que livre chaque fournisseur (frais, sec, surgelé) : la tablette ne demande que les températures utiles.
-- Vide = inconnu : toutes les températures sont demandées.
alter table fournisseurs add column produits text[] check (produits <@ array['frais', 'sec', 'surgele']);
