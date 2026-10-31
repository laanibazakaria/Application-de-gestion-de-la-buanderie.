/**
 * Applique les migrations SQL du dossier ./drizzle (idempotent).
 * Utilisé en local (`pnpm db:migrate`) et à chaque déploiement Vercel (voir vercel.json).
 *
 * Utilise de préférence la connexion DIRECTE (DATABASE_URL_UNPOOLED, fournie par
 * l'intégration Neon) : le pooler en mode transaction n'est pas adapté aux migrations.
 */
import "dotenv/config";

import { runMigrations } from "../src/server/db/migrate";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL (ou DATABASE_URL_UNPOOLED) n'est pas définie.");
  process.exit(1);
}

runMigrations(url)
  .then(() => console.log(`Migrations appliquées sur ${new URL(url).hostname}.`))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
