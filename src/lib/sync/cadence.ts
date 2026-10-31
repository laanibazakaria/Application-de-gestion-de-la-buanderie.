import type { LaundryStateView } from "../state-types";

export const FAST_MS = 3_000;
export const MEDIUM_MS = 5_000;
export const SLOW_MS = 15_000;
/** Marge après une échéance connue avant de rafraîchir (le serveur la traite à la requête suivante). */
const DEADLINE_MARGIN_MS = 1_000;

/**
 * Intervalle de rafraîchissement, choisi pour rester dans les quotas gratuits :
 * - 3 s : l'étudiant est appelé (ou présent) ou en tête de file ;
 * - 5 s : dans les 3 premières places ; et pour l'administrateur (1 à 2 comptes, il pilote) ;
 * - 15 s : tous les autres cas.
 * Si une échéance qui concerne l'utilisateur tombe avant, on rafraîchit juste après elle.
 */
export function baseIntervalMs(state: LaundryStateView | null): number {
  if (!state) return SLOW_MS;
  let interval = state.viewer.role === "admin" ? MEDIUM_MS : SLOW_MS;
  for (const r of state.me.reservations) {
    if (r.status === "called" || r.status === "confirmed" || r.position === 1) return FAST_MS;
    if (r.position !== null && r.position <= 3) interval = Math.min(interval, MEDIUM_MS);
  }
  return interval;
}

export function nextPollDelayMs(state: LaundryStateView | null, serverNowMs: number): number {
  const base = baseIntervalMs(state);
  if (!state) return base;
  const deadlines: number[] = [];
  if (state.me.cycle) deadlines.push(Date.parse(state.me.cycle.plannedEndAt));
  for (const r of state.me.reservations) if (r.deadlineAt) deadlines.push(Date.parse(r.deadlineAt));
  let delay = base;
  for (const d of deadlines) {
    const until = d - serverNowMs + DEADLINE_MARGIN_MS;
    if (until > 0 && until < delay) delay = until;
  }
  return Math.max(500, delay);
}
