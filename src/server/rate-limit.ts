import { sql } from "drizzle-orm";

import { now } from "./clock";
import { getDb } from "./db/client";
import { HttpError } from "./http/errors";

export interface RateLimitRule {
  /** Nom de la règle (préfixe de la clé). */
  name: string;
  limit: number;
  windowSec: number;
}

/**
 * Limitation par fenêtre fixe, stockée dans PostgreSQL (une seule requête,
 * atomique grâce à INSERT … ON CONFLICT). Vercel n'offre pas de mémoire partagée
 * entre instances : un compteur en mémoire serait contournable.
 *
 * Appliquée uniquement aux connexions et aux actions, jamais au rafraîchissement
 * de la page, pour ne pas consommer le quota de la base.
 */
export async function enforceRateLimit(rule: RateLimitRule, subject: string): Promise<void> {
  const key = `${rule.name}:${subject}`.slice(0, 200);
  const at = now();
  const windowStart = new Date(at.getTime() - rule.windowSec * 1000);
  const result = await getDb().execute<{ count: number; window_start: Date }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${at}, 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start <= ${windowStart} then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start <= ${windowStart} then ${at} else rate_limits.window_start end
    returning count, window_start
  `);
  const row = result.rows[0];
  if (row && row.count > rule.limit) {
    const resetAt = new Date(row.window_start).getTime() + rule.windowSec * 1000;
    const retryAfter = Math.max(1, Math.ceil((resetAt - at.getTime()) / 1000));
    throw new HttpError(429, "RATE_LIMITED", "Trop de requêtes, réessayez plus tard", {
      "Retry-After": String(retryAfter),
    });
  }
}

export async function purgeRateLimits(): Promise<void> {
  await getDb().execute(
    sql`delete from rate_limits where window_start < ${new Date(now().getTime() - 86_400_000)}`,
  );
}

export const RULES = {
  /** Tout l'internat peut partager la même adresse IP (NAT) : limite large par IP… */
  loginPerIp: { name: "login-ip", limit: 100, windowSec: 900 },
  /** … et stricte par compte, contre la recherche de mot de passe. */
  loginPerAccount: { name: "login-account", limit: 10, windowSec: 900 },
  /** Actions (réserver, annuler, piloter…) par utilisateur. */
  actionsPerUser: { name: "actions", limit: 60, windowSec: 60 },
} satisfies Record<string, RateLimitRule>;
