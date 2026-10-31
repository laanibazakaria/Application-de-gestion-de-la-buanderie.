import { describe, expect, it } from "vitest";

import { computeEstimates } from "@/server/domain/estimate";

import { at, makeMachines, runningCycle, T0, waiting } from "./fixtures";

describe("estimation des heures de disponibilité", () => {
  it("fin du cycle en cours + durées par défaut des personnes devant", () => {
    const machines = makeMachines(1).map((m) => ({ ...m, status: "running" as const }));
    const runningCycles = [runningCycle({ machineId: 1, studentId: "x", plannedEndAt: at(20) })];
    const res = [
      waiting({ id: "r1", studentId: "s1", rank: 1, targetMachineId: 1 }),
      waiting({ id: "r2", studentId: "s2", rank: 2, targetMachineId: 1 }),
      waiting({ id: "r3", studentId: "s3", rank: 3, targetMachineId: 1 }),
    ];
    const e = computeEstimates({ machines, runningCycles, activeReservations: res, now: T0 });
    expect(e.byReservation.get("r1")?.at).toEqual(at(20));
    expect(e.byReservation.get("r2")?.at).toEqual(at(65)); // + 45
    expect(e.byReservation.get("r3")?.at).toEqual(at(110)); // + 45
    expect(e.machineFreeAt.get(1)).toEqual(at(20));
  });

  it("machine en attente d'un étudiant : maintenant + durée par défaut", () => {
    const machines = makeMachines(1).map((m) => ({ ...m, status: "awaiting_student" as const }));
    const res = [waiting({ id: "r1", studentId: "s1", targetMachineId: 1 })];
    const e = computeEstimates({ machines, runningCycles: [], activeReservations: res, now: T0 });
    expect(e.byReservation.get("r1")?.at).toEqual(at(45));
  });

  it("« première disponible » prend la machine qui se libère le plus tôt", () => {
    const machines = makeMachines(2).map((m) => ({ ...m, status: "running" as const }));
    const runningCycles = [
      runningCycle({ machineId: 1, studentId: "x", plannedEndAt: at(30) }),
      runningCycle({ machineId: 2, studentId: "y", plannedEndAt: at(10) }),
    ];
    const res = [
      waiting({ id: "any1", studentId: "s1", rank: 1 }),
      waiting({ id: "m2", studentId: "s2", rank: 2, targetMachineId: 2 }),
      waiting({ id: "any2", studentId: "s3", rank: 3 }),
    ];
    const e = computeEstimates({ machines, runningCycles, activeReservations: res, now: T0 });
    expect(e.byReservation.get("any1")).toEqual({ at: at(10), machineId: 2 });
    expect(e.byReservation.get("m2")).toEqual({ at: at(55), machineId: 2 });
    expect(e.byReservation.get("any2")).toEqual({ at: at(30), machineId: 1 });
  });

  it("machine hors service : pas d'estimation", () => {
    const machines = makeMachines(1).map((m) => ({ ...m, status: "out_of_service" as const }));
    const res = [waiting({ id: "r1", studentId: "s1", targetMachineId: 1 })];
    const e = computeEstimates({ machines, runningCycles: [], activeReservations: res, now: T0 });
    expect(e.byReservation.get("r1")).toEqual({ at: null, machineId: null });
    expect(e.machineFreeAt.get(1)).toBeNull();
  });

  it("un cycle en retard (échéance non encore traitée) ne donne pas une heure passée", () => {
    const machines = makeMachines(1).map((m) => ({ ...m, status: "running" as const }));
    const runningCycles = [runningCycle({ machineId: 1, studentId: "x", plannedEndAt: at(-5) })];
    const res = [waiting({ id: "r1", studentId: "s1", targetMachineId: 1 })];
    const e = computeEstimates({ machines, runningCycles, activeReservations: res, now: T0 });
    expect(e.byReservation.get("r1")?.at).toEqual(T0);
  });
});
