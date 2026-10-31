import { DomainError } from "./errors";

/**
 * Machine à états d'une réservation.
 *
 *   waiting ──call──▶ called ──confirm──▶ confirmed ──fulfill──▶ fulfilled
 *      ▲  ◀──uncall───┴─────────uncall───────┘                  (cycle lancé)
 *   called    ──expire──▶ expired     (délai de présentation dépassé)
 *   confirmed ──expire──▶ expired     (cycle non lancé dans le second délai)
 *   waiting | called | confirmed ──cancel──▶ cancelled
 *
 * `uncall` sert quand la machine de l'étudiant appelé (ou déjà présent) passe
 * hors service : il retourne en attente en gardant sa place. Les états `fulfilled`, `expired` et
 * `cancelled` sont terminaux.
 *
 * Le cahier des charges cite cinq statuts ; on ajoute `fulfilled` (« honorée »)
 * pour distinguer une réservation devenue cycle d'une réservation encore active.
 */
export const RESERVATION_STATUSES = [
  "waiting",
  "called",
  "confirmed",
  "fulfilled",
  "expired",
  "cancelled",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const ACTIVE_RESERVATION_STATUSES = [
  "waiting",
  "called",
  "confirmed",
] as const satisfies readonly ReservationStatus[];
export type ActiveReservationStatus = (typeof ACTIVE_RESERVATION_STATUSES)[number];

export const RESERVATION_EVENTS = ["call", "uncall", "confirm", "fulfill", "expire", "cancel"] as const;
export type ReservationEvent = (typeof RESERVATION_EVENTS)[number];

const TRANSITIONS: Readonly<Record<ReservationStatus, Partial<Record<ReservationEvent, ReservationStatus>>>> =
  {
    waiting: { call: "called", cancel: "cancelled" },
    called: { uncall: "waiting", confirm: "confirmed", expire: "expired", cancel: "cancelled" },
    confirmed: { uncall: "waiting", fulfill: "fulfilled", expire: "expired", cancel: "cancelled" },
    fulfilled: {},
    expired: {},
    cancelled: {},
  };

export function isActiveReservationStatus(s: ReservationStatus): s is ActiveReservationStatus {
  return (ACTIVE_RESERVATION_STATUSES as readonly string[]).includes(s);
}

export function canTransitionReservation(from: ReservationStatus, event: ReservationEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

export function transitionReservation(from: ReservationStatus, event: ReservationEvent): ReservationStatus {
  const to = TRANSITIONS[from][event];
  if (!to) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Réservation : transition « ${event} » impossible depuis « ${from} »`,
      { entity: "reservation", from, event },
    );
  }
  return to;
}
