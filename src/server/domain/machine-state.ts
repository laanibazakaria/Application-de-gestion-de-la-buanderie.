import { DomainError } from "./errors";

/**
 * Machine à états d'une machine à laver.
 *
 *   free ──call──▶ awaiting_student ──start_cycle──▶ running
 *    ▲  ◀──release_call──┘                              │
 *    │                                                  │ extend_cycle (reste en running)
 *    └────────────────────end_cycle─────────────────────┘
 *   free ──start_cycle──▶ running        (lancement direct par l'admin, étudiant présent sans réservation)
 *   free | awaiting_student ──disable──▶ out_of_service ──enable──▶ free
 *
 * Toute autre combinaison (état, événement) est refusée. En particulier, on ne peut
 * pas mettre hors service une machine dont le cycle tourne : il faut d'abord le
 * terminer ou l'annuler.
 */
export const MACHINE_STATUSES = ["free", "awaiting_student", "running", "out_of_service"] as const;
export type MachineStatus = (typeof MACHINE_STATUSES)[number];

export const MACHINE_EVENTS = [
  "call",
  "release_call",
  "start_cycle",
  "extend_cycle",
  "end_cycle",
  "disable",
  "enable",
] as const;
export type MachineEvent = (typeof MACHINE_EVENTS)[number];

const TRANSITIONS: Readonly<Record<MachineStatus, Partial<Record<MachineEvent, MachineStatus>>>> = {
  free: { call: "awaiting_student", start_cycle: "running", disable: "out_of_service" },
  awaiting_student: { release_call: "free", start_cycle: "running", disable: "out_of_service" },
  running: { extend_cycle: "running", end_cycle: "free" },
  out_of_service: { enable: "free" },
};

export function canTransitionMachine(from: MachineStatus, event: MachineEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

/** Renvoie le nouvel état, ou lève `INVALID_TRANSITION`. */
export function transitionMachine(from: MachineStatus, event: MachineEvent): MachineStatus {
  const to = TRANSITIONS[from][event];
  if (!to) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Machine : transition « ${event} » impossible depuis « ${from} »`,
      {
        entity: "machine",
        from,
        event,
      },
    );
  }
  return to;
}
