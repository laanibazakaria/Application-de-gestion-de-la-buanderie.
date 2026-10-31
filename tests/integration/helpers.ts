import { Pool } from "pg";

import { createDb, type Database } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

/** Recrée entièrement la base de test (schéma vide puis migrations). */
export async function resetDatabase(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(
      "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;",
    );
  } finally {
    await pool.end();
  }
  await runMigrations(url);
}

export function testDb(): { pool: Pool; db: Database } {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  return { pool, db: createDb(pool) };
}
