import type { Reservation } from "./types";

/** Ordre total et déterministe des réservations : rang, puis date de création, puis identifiant. */
export function compareReservations(a: Reservation, b: Reservation): number {
  return a.rank - b.rank || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/** Réservations en attente, dans l'ordre global d'arrivée. */
export function waitingInOrder(reservations: Iterable<Reservation>): Reservation[] {
  return [...reservations].filter((r) => r.status === "waiting").sort(compareReservations);
}

/** Une réservation en attente peut être servie par la machine si elle la cible ou si elle accepte « première disponible ». */
export function isEligibleFor(r: Reservation, machineId: number): boolean {
  return r.status === "waiting" && (r.targetMachineId === machineId || r.targetMachineId === null);
}

/** File d'une machine : réservations qui la ciblent + « première disponible », dans l'ordre global. */
export function machineQueue(machineId: number, reservations: Iterable<Reservation>): Reservation[] {
  return waitingInOrder(reservations).filter((r) => isEligibleFor(r, machineId));
}

/**
 * Prochaine réservation à appeler quand `machineId` se libère.
 * L'ordre d'arrivée global est respecté : une réservation « première disponible »
 * plus ancienne passe avant une réservation ciblée plus récente.
 */
export function pickNextForMachine(
  machineId: number,
  reservations: Iterable<Reservation>,
): Reservation | null {
  return machineQueue(machineId, reservations)[0] ?? null;
}

/**
 * Position affichée dans « Ma réservation » (1 = prochain servi) :
 * - réservation ciblée : position dans la file de cette machine ;
 * - « première disponible » : position parmi toutes les réservations en attente.
 */
export function positionOf(reservation: Reservation, reservations: Iterable<Reservation>): number | null {
  if (reservation.status !== "waiting") return null;
  const list =
    reservation.targetMachineId === null
      ? waitingInOrder(reservations)
      : machineQueue(reservation.targetMachineId, reservations);
  const index = list.findIndex((r) => r.id === reservation.id);
  return index === -1 ? null : index + 1;
}

/** Écart minimal entre deux rangs avant de renuméroter la file. */
export const MIN_RANK_GAP = 1e-6;

/**
 * Calcule le rang pour placer une réservation juste avant `before` (ou en fin de file si `before` est `null`).
 * Renvoie `null` si l'écart est trop petit : il faut alors renuméroter (voir `renumber`).
 */
export function rankBefore(ordered: Reservation[], before: Reservation | null): number | null {
  if (!before) return (ordered.at(-1)?.rank ?? 0) + 1;
  const index = ordered.findIndex((r) => r.id === before.id);
  if (index === -1) return null;
  const prev = ordered[index - 1];
  if (!prev) return before.rank - 1;
  const mid = (prev.rank + before.rank) / 2;
  return before.rank - prev.rank < MIN_RANK_GAP * 2 ? null : mid;
}
