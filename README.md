# Buanderie de l'internat

Plateforme web de réservation des 7 machines à laver de l'internat (Next.js + PostgreSQL, déployée sur Vercel + Neon).

> La documentation complète (installation, variables d'environnement, tests, déploiement Vercel/Neon,
> configuration de cron-job.org, estimation des quotas) sera rédigée à la dernière étape.

## Démarrage rapide (développement)

Prérequis : Node.js 22, pnpm 10, PostgreSQL 16 local.

```bash
pnpm install
cp .env.example .env   # puis adapter les valeurs
pnpm db:migrate
pnpm dev
```

## Vérifications

`pnpm check` lance, dans l'ordre : formatage, lint, typage, tests unitaires et d'intégration, build de production.
