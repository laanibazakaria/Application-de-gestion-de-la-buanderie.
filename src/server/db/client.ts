import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

/**
 * Pilote unique `pg` (TCP), en local comme sur Vercel.
 *
 * Sur Vercel (Fluid compute), une instance de fonction traite plusieurs requêtes :
 * on garde donc un petit pool global, et `attachDatabasePool` ferme proprement les
 * connexions inactives avant que l'instance soit suspendue. En production,
 * DATABASE_URL doit être la chaîne « pooled » de Neon (PgBouncer côté Neon).
 */
const globalForDb = globalThis as unknown as { __buanderiePool?: Pool; __buanderieDb?: Database };

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function getDb(): Database {
  if (!globalForDb.__buanderieDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL n'est pas définie");
    const pool = createPool(url);
    if (process.env.VERCEL) attachDatabasePool(pool);
    globalForDb.__buanderiePool = pool;
    globalForDb.__buanderieDb = drizzle(pool, { schema });
  }
  return globalForDb.__buanderieDb;
}

export function createDb(pool: Pool): Database {
  return drizzle(pool, { schema });
}

/** Ferme le pool global (scripts en ligne de commande). */
export async function closeDb(): Promise<void> {
  await globalForDb.__buanderiePool?.end();
  globalForDb.__buanderiePool = undefined;
  globalForDb.__buanderieDb = undefined;
}
