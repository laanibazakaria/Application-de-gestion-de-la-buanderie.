import type { Database } from "../db/client";
import { activityLog } from "../db/schema";
import type { LogEntry } from "../domain/types";

import type { Tx } from "./laundry-tx";

/** Écrit une entrée du journal hors transaction métier (connexion, comptes…). */
export async function logActivity(db: Database | Tx, entry: LogEntry, at: Date): Promise<void> {
  await db.insert(activityLog).values({ at, ...entry });
}
