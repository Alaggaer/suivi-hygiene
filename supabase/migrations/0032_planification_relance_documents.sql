-- Rappel quotidien des documents qui expirent (8 h 23, heure de Paris en hiver).
select cron.schedule('relancer-documents', '23 7 * * *', 'select public.relancer_documents()');
