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
- [ ] Semaine 2 : livraisons, produit utilisé, photos, hors ligne
- [ ] Semaine 3 : minuteurs, anomalies (traitement), escalades et notifications
- [ ] Semaine 4 : tableau de bord siège, paramétrage, pilote 2 sites
