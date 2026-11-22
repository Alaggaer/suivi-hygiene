-- Nombre de lignes de chaque table de l'application (« table|nombre »), identique avant export et après restauration.
select t.tablename || '|' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.tablename), false, true, '')))[1]::text
from pg_tables t where t.schemaname = 'public' order by 1;
