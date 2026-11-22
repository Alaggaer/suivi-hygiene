-- Relance quotidienne des visites Eurofins en retard (8 h 19, heure de Paris en hiver).
select cron.schedule('relancer-visites', '19 7 * * *', 'select public.relancer_visites()');
