# Restaurer une sauvegarde

1. Dans ce dépôt privé : **Actions** → « Sauvegarde quotidienne » → cliquer sur le jour voulu → en bas, télécharger l'archive `sauvegarde-AAAA-MM-JJ`.
   Le fichier `comptes.txt` à l'intérieur indique ce que contient la copie (nombre de restaurants, relevés, livraisons, anomalies…).
2. Déchiffrer (demande la phrase secrète `BACKUP_PASSPHRASE`) :
   `gpg --decrypt suivi-hygiene-AAAA-MM-JJ.tar.gpg > sauvegarde.tar && tar -xf sauvegarde.tar`
   → deux fichiers : `app-….dump` (toute l'application) et `comptes-photos-….dump` (comptes de connexion et index des photos).
3. Restaurer dans un projet Supabase **neuf** (pour ne rien écraser) :
   - `pg_restore --no-owner --no-privileges -d "<chaîne de connexion>" app-AAAA-MM-JJ.dump`
   - `pg_restore --no-owner --no-privileges --data-only -d "<chaîne de connexion>" comptes-photos-AAAA-MM-JJ.dump`
4. Les photos elles-mêmes restent dans le stockage Supabase ; la sauvegarde contient leur index (`storage.objects`).
   Une copie indépendante des photos est prévue avec l'export Google Drive.

Rétention : 90 jours (une archive par nuit, vers 3 h 30).
