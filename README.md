# Suivi Hygiène

App tablette de suivi d'hygiène (HACCP) pour les restaurants du groupe, et tableau de bord siège.

- `app/` : PWA React + TypeScript (Vite). Sans variables Supabase, elle tourne en **mode démonstration** (serveur simulé).
- `supabase/migrations/` : schéma Postgres (RLS par site, aucune suppression possible, journal des modifications).

## Lancer en local
```
cd app && npm install && npm run dev
```
Pour brancher Supabase : copier `app/.env.example` en `app/.env` et renseigner l'URL et la clé publique (anon).
Ne jamais mettre la clé `service_role` dans l'app.

## Avancement (MVP)
- [x] Schéma de base testé (contrôles, interdiction de suppression, journal, PIN)
- [x] Semaine 1 : activation tablette, connexion PIN, tâches du jour avec retards, relevés de températures, huile
- [x] Semaine 2 : file d'envoi hors ligne (IndexedDB, rejouable sans doublon), lectures et PIN hors ligne, livraisons, produit utilisé, photos compressées, minuteur de rangement
- [x] Semaine 3 : minuteurs refroidissement / remise en T°, cycle des anomalies (droits par rôle), Signaler, tâches simples, relances côté serveur (file de notifications ; envoi push à brancher)
- [ ] Semaine 4 : tableau de bord siège, paramétrage, pilote 2 sites

## Tests
```
cd app && npm test            # règles métier, file hors ligne, cache (vitest)
cd app && npm run test:e2e    # parcours tablette dans un vrai navigateur (playwright, mode démo)
./supabase/tests/run.sh       # migrations + règles de la base sur un Postgres jetable (contrôles, RLS, idempotence)
```
