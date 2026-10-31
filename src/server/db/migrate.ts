import { existsSync } from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

/** Applique toutes les migrations en attente (idempotent). */
export async function runMigrations(connectionString: string): Promise<void> {
  if (!existsSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"))) return;
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
