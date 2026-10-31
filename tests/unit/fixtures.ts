import { Laundry } from "@/server/domain/laundry";
import type { WeeklyHours } from "@/server/domain/opening-hours";
import {
  DEFAULT_SETTINGS,
  type Actor,
  type Cycle,
  type LaundrySnapshot,
  type Machine,
  type Reservation,
  type Settings,
} from "@/server/domain/types";
import { addMinutes } from "@/lib/time";

export const TZ = "Africa/Casablanca";

/** Mercredi 14 janvier 2026, 11:00 à Casablanca (UTC+1). */
export const T0 = new Date("2026-01-14T10:00:00Z");

const h = (hh: number, mm = 0) => hh * 60 + mm;

/** Ouvert tous les jours de 07:00 à 23:00. */
export const ALWAYS_DAYTIME: WeeklyHours = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7].map((d) => [d, { openMinute: h(7), closeMinute: h(23) }]),
);

export const admin: Actor = { kind: "user", id: "admin-1", role: "admin" };
export const student = (id: string): Actor => ({ kind: "user", id, role: "student" });

export function makeMachines(count = 7): Machine[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    number: i + 1,
    name: `Machine ${i + 1}`,
    status: "free" as const,
    defaultDurationMin: 45,
  }));
}

export function makeSnapshot(
  over: Omit<Partial<LaundrySnapshot>, "settings"> & { settings?: Partial<Settings> } = {},
): LaundrySnapshot {
  return {
    machines: over.machines ?? makeMachines(),
    runningCycles: over.runningCycles ?? [],
    activeReservations: over.activeReservations ?? [],
    settings: { ...DEFAULT_SETTINGS, ...over.settings },
    hours: over.hours ?? ALWAYS_DAYTIME,
    timeZone: TZ,
  };
}

export function runningCycle(over: Partial<Cycle> & Pick<Cycle, "machineId" | "studentId">): Cycle {
  const startedAt = over.startedAt ?? addMinutes(T0, -15);
  const duration = over.plannedDurationMin ?? 45;
  return {
    id: over.id ?? `cycle-m${over.machineId}`,
    reservationId: null,
    startedAt,
    plannedDurationMin: duration,
    plannedEndAt: over.plannedEndAt ?? addMinutes(startedAt, duration),
    actualEndAt: null,
    status: "running",
    endReason: null,
    ...over,
  };
}

export function waiting(over: Partial<Reservation> & Pick<Reservation, "id" | "studentId">): Reservation {
  return {
    targetMachineId: null,
    assignedMachineId: null,
    rank: 1,
    status: "waiting",
    createdAt: addMinutes(T0, -10),
    calledAt: null,
    callDeadlineAt: null,
    confirmedAt: null,
    confirmDeadlineAt: null,
    closedAt: null,
    closeReason: null,
    notice: null,
    ...over,
  };
}

/** Toutes les machines occupées par des cycles qui se terminent à +10, +20, … minutes. */
export function allBusy(): { machines: Machine[]; runningCycles: Cycle[] } {
  const machines = makeMachines().map((m) => ({ ...m, status: "running" as const }));
  const runningCycles = machines.map((m) =>
    runningCycle({ machineId: m.id, studentId: `busy-${m.id}`, plannedEndAt: addMinutes(T0, 10 * m.number) }),
  );
  return { machines, runningCycles };
}

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

/** Crée un moteur à l'instant `now` (par défaut T0). */
export function laundry(snapshot: LaundrySnapshot, now: Date = T0): Laundry {
  return new Laundry(snapshot, { now, newId });
}

/**
 * Simule une transaction suivante : on recharge l'état actif produit par `previous`
 * comme le ferait le service depuis la base, à un nouvel instant.
 */
export function next(
  previous: Laundry,
  now: Date,
  snapshot?: Omit<Partial<LaundrySnapshot>, "settings">,
): Laundry {
  const base = makeSnapshot({
    machines: previous.machineList(),
    runningCycles: previous.runningCycleList(),
    activeReservations: previous.activeReservationList(),
    ...snapshot,
  });
  return new Laundry(base, { now, newId });
}

export const at = (minutes: number) => addMinutes(T0, minutes);
