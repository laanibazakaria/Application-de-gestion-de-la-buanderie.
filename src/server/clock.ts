/**
 * Horloge du serveur. En production, c'est simplement l'heure système.
 *
 * Pour les tests de bout en bout uniquement, un décalage peut être appliqué
 * (route /api/test/clock) afin de tester une expiration sans attendre 5 minutes.
 * Ce décalage n'est pris en compte que si TOUTES les conditions suivantes sont
 * vraies — chacune suffit à le désactiver :
 *
 *   1. E2E_TEST_CLOCK vaut exactement "1" ;
 *   2. on ne tourne pas sur Vercel (aucune variable système VERCEL, VERCEL_ENV, VERCEL_URL) ;
 *   3. la base de données est sur localhost ;
 *   4. l'URL publique de l'application (APP_URL) est sur localhost.
 *
 * Sur Vercel avec Neon, les conditions 2, 3 et 4 sont impossibles à réunir,
 * même si E2E_TEST_CLOCK est définie par erreur.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLocalUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function isTestClockAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.E2E_TEST_CLOCK === "1" &&
    !env.VERCEL &&
    !env.VERCEL_ENV &&
    !env.VERCEL_URL &&
    isLocalUrl(env.DATABASE_URL) &&
    isLocalUrl(env.APP_URL)
  );
}

const state = globalThis as unknown as { __buanderieClockOffsetMs?: number };

/** Heure courante du serveur (UTC). */
export function now(): Date {
  const offset = isTestClockAllowed() ? (state.__buanderieClockOffsetMs ?? 0) : 0;
  return new Date(Date.now() + offset);
}

/** Décale l'horloge de test. Refuse si l'horloge de test n'est pas autorisée. */
export function setTestClockOffset(offsetMs: number): void {
  if (!isTestClockAllowed()) throw new Error("Horloge de test désactivée");
  state.__buanderieClockOffsetMs = offsetMs;
}

export function getTestClockOffset(): number {
  return isTestClockAllowed() ? (state.__buanderieClockOffsetMs ?? 0) : 0;
}
