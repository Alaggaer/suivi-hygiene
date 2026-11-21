-- Relance quotidienne du plan d'action, des contrôles et des sondes (8 h 13, heure de Paris en hiver).
select cron.schedule('relancer-pms', '13 7 * * *', 'select public.relancer_pms()');
