-- Fournisseurs du groupe (tableau de paramétrage, 21/11/2026)
insert into fournisseurs (nom, viande, produits) values
  ('AMERICAN DESSERT', false, array['surgele']::text[]),
  ('BEAUVALLET', true, array['frais']::text[]),
  ('BOULANGERIE THIERRY', false, array['surgele']::text[]),
  ('BRASSERIE BOS', false, array['sec']::text[]),
  ('C 10', false, array['sec']::text[]),
  ('CAFES RICHARD', false, array['sec']::text[]),
  ('COUP DE PÂTES', false, array['frais']::text[]),
  ('DELIDRINKS', false, array['sec']::text[]),
  ('EPISAVEURS', false, array['frais','sec']::text[]),
  ('FRAICH POM', false, array['frais']::text[]),
  ('KRILL', false, array['surgele']::text[]),
  ('MONIN', false, array['sec']::text[]),
  ('PVM', false, null),
  ('SAVEURS FRITES', false, array['frais']::text[]),
  ('SDV', false, array['frais']::text[]),
  ('SDV - Sec', false, array['sec']::text[]),
  ('SDV - Surgelé', false, array['surgele']::text[]),
  ('SYSCO', false, array['frais','surgele']::text[]),
  ('SYSCO Préco', false, array['frais','surgele']::text[]),
  ('TERRE AZUR', false, array['frais','surgele']::text[]),
  ('TERRE AZUR - Préco', false, array['frais','surgele']::text[])
on conflict (nom) do update set viande = excluded.viande, produits = excluded.produits;
