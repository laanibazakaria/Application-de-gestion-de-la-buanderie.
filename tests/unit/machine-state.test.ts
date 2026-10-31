import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/domain/errors";
import {
  canTransitionMachine,
  MACHINE_EVENTS,
  MACHINE_STATUSES,
  transitionMachine,
  type MachineEvent,
  type MachineStatus,
} from "@/server/domain/machine-state";

const ALLOWED: Array<[MachineStatus, MachineEvent, MachineStatus]> = [
  ["free", "call", "awaiting_student"],
  ["free", "start_cycle", "running"],
  ["free", "disable", "out_of_service"],
  ["awaiting_student", "release_call", "free"],
  ["awaiting_student", "start_cycle", "running"],
  ["awaiting_student", "disable", "out_of_service"],
  ["running", "extend_cycle", "running"],
  ["running", "end_cycle", "free"],
  ["out_of_service", "enable", "free"],
];

describe("machine à états : machine", () => {
  it.each(ALLOWED)("%s --%s--> %s", (from, event, to) => {
    expect(transitionMachine(from, event)).toBe(to);
  });

  it("refuse toutes les autres transitions", () => {
    let refused = 0;
    for (const from of MACHINE_STATUSES) {
      for (const event of MACHINE_EVENTS) {
        if (ALLOWED.some(([f, e]) => f === from && e === event)) continue;
        expect(canTransitionMachine(from, event)).toBe(false);
        expect(() => transitionMachine(from, event)).toThrow(DomainError);
        refused++;
      }
    }
    expect(refused).toBe(MACHINE_STATUSES.length * MACHINE_EVENTS.length - ALLOWED.length);
  });

  it("refuse de mettre hors service une machine en cours de cycle", () => {
    try {
      transitionMachine("running", "disable");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_TRANSITION");
      expect((e as DomainError).httpStatus).toBe(409);
    }
  });
});
