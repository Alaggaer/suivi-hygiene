-- Relance des alertes produit sans réponse (toutes les 5 minutes ; l'envoi suit la file des notifications).
select cron.schedule('relancer-alertes-produit', '2-59/5 * * * *', 'select public.relancer_alertes_produit()');
