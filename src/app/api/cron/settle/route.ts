import { timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";

import { purgeExpiredSessions } from "@/server/auth/session";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { laundryState } from "@/server/db/schema";
import { env } from "@/server/env";
import { errorResponse, json, toErrorResponse } from "@/server/http/route";
import { purgeRateLimits } from "@/server/rate-limit";
import { settleDeadlines } from "@/server/services/laundry-tx";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = Buffer.from(`Bearer ${env().CRON_SECRET}`);
  const received = Buffer.from(req.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Filet de sécurité appelé chaque minute par cron-job.org (voir README) :
 * traite les échéances même quand personne n'a la page ouverte.
 * Si aucune échéance n'est atteinte, une seule lecture par clé primaire, sans verrou.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    if (!authorized(req)) return errorResponse(401, "UNAUTHENTICATED", "Secret invalide");
    const at = now();
    const [state] = await getDb()
      .select({ nextDeadlineAt: laundryState.nextDeadlineAt })
      .from(laundryState)
      .where(eq(laundryState.id, 1));
    const due = state?.nextDeadlineAt != null && state.nextDeadlineAt.getTime() <= at.getTime();
    const settled = due ? await settleDeadlines() : 0;
    // Nettoyage une fois par heure.
    if (at.getUTCMinutes() === 0) await Promise.all([purgeExpiredSessions(), purgeRateLimits()]);
    return json({ settled, due });
  } catch (err) {
    return toErrorResponse(err);
  }
}
