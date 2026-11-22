# Restaurer une sauvegarde

## Où sont les copies

| Copie | Où | Durée |
|---|---|---|
| Base, chaque nuit | Ce dépôt : **Actions** → « Sauvegarde quotidienne » → le jour voulu → archive `sauvegarde-AAAA-MM-JJ` | 90 jours |
| Base, chaque nuit | Google Drive : `suivi-hygiene/base/quotidien/` | 90 jours |
| Base, une par mois | Google Drive : `suivi-hygiene/base/mensuel/` **et** ce dépôt : dossier `archives/` | pour toujours |
| Photos et documents du PMS | Google Drive : `suivi-hygiene/photos/` (même arborescence que dans Supabase) | pour toujours, jamais effacés |

Chaque nuit, la sauvegarde est restaurée dans une base vide et comparée table par table à l'originale ; les photos sont recomptées dans le Drive.
Le résultat est dans `historique/derniere-sauvegarde.txt`. Si une nuit échoue, GitHub envoie un e-mail, et la base alerte le siège après 26 h sans sauvegarde réussie.

## Restaurer la base

1. Récupérer le fichier `suivi-hygiene-AAAA-MM-JJ.tar.gpg` (voir tableau ci-dessus).
2. Déchiffrer (demande la phrase secrète `BACKUP_PASSPHRASE`) :
   `gpg --decrypt suivi-hygiene-AAAA-MM-JJ.tar.gpg > sauvegarde.tar && tar -xf sauvegarde.tar`
   → deux fichiers : `app-….dump` (toute l'application) et `comptes-photos-….dump` (comptes de connexion et index des photos).
3. Restaurer dans un projet Supabase **neuf** (pour ne rien écraser) :
   - `pg_restore --no-owner --no-privileges -d "<chaîne de connexion>" app-AAAA-MM-JJ.dump`
   - `pg_restore --no-owner --no-privileges --data-only -d "<chaîne de connexion>" comptes-photos-AAAA-MM-JJ.dump`

## Restaurer les photos

Recopier le dossier Drive vers le stockage du nouveau projet (bucket `photos`), par exemple avec rclone :
`rclone copy sauvegarde:suivi-hygiene/photos nouveau-projet:photos`
Les chemins sont identiques : les liens enregistrés dans la base retrouvent leurs fichiers.
