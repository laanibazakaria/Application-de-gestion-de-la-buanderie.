/**
 * Applique les migrations SQL du dossier ./drizzle sur DATABASE_URL.
 * Utilisé en local (`pnpm db:migrate`) et lors du déploiement (voir README).
 */
import "dotenv/config";

import { runMigrations } from "../src/server/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL n'est pas définie.");
  process.exit(1);
}

runMigrations(url)
  .then(() => console.log("Migrations appliquées."))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
