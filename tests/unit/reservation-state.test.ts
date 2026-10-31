import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/domain/errors";
import {
  canTransitionReservation,
  isActiveReservationStatus,
  RESERVATION_EVENTS,
  RESERVATION_STATUSES,
  transitionReservation,
  type ReservationEvent,
  type ReservationStatus,
} from "@/server/domain/reservation-state";

const ALLOWED: Array<[ReservationStatus, ReservationEvent, ReservationStatus]> = [
  ["waiting", "call", "called"],
  ["waiting", "cancel", "cancelled"],
  ["called", "uncall", "waiting"],
  ["called", "confirm", "confirmed"],
  ["called", "expire", "expired"],
  ["called", "cancel", "cancelled"],
  ["confirmed", "uncall", "waiting"],
  ["confirmed", "fulfill", "fulfilled"],
  ["confirmed", "expire", "expired"],
  ["confirmed", "cancel", "cancelled"],
];

describe("machine à états : réservation", () => {
  it.each(ALLOWED)("%s --%s--> %s", (from, event, to) => {
    expect(transitionReservation(from, event)).toBe(to);
  });

  it("refuse toutes les autres transitions", () => {
    for (const from of RESERVATION_STATUSES) {
      for (const event of RESERVATION_EVENTS) {
        if (ALLOWED.some(([f, e]) => f === from && e === event)) continue;
        expect(canTransitionReservation(from, event)).toBe(false);
        expect(() => transitionReservation(from, event)).toThrow(DomainError);
      }
    }
  });

  it("les états honorée, expirée et annulée sont terminaux", () => {
    for (const s of ["fulfilled", "expired", "cancelled"] as const) {
      expect(isActiveReservationStatus(s)).toBe(false);
      for (const e of RESERVATION_EVENTS) expect(canTransitionReservation(s, e)).toBe(false);
    }
  });

  it("on ne peut pas lancer un cycle sans avoir confirmé sa présence", () => {
    expect(canTransitionReservation("called", "fulfill")).toBe(false);
    expect(canTransitionReservation("waiting", "confirm")).toBe(false);
  });
});
