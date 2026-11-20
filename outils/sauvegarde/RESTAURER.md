# Restaurer une sauvegarde

1. Dans le dépôt privé des sauvegardes : Actions → « Sauvegarde quotidienne » → choisir le jour → télécharger l'archive.
2. Déchiffrer : `gpg --decrypt suivi-hygiene-AAAA-MM-JJ.dump.gpg > sauvegarde.dump` (demande la phrase secrète).
3. Restaurer dans un projet Supabase (neuf de préférence, pour ne rien écraser) :
   `pg_restore --no-owner --no-privileges -d "<chaîne de connexion>" sauvegarde.dump`
4. Les photos restent dans le stockage Supabase ; la sauvegarde contient leur index (`storage.objects`).
   Une copie indépendante des photos (export hebdomadaire) est prévue avec l'export Google Drive.
