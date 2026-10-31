import { describe, expect, it } from "vitest";

import { DomainError, type DomainErrorCode } from "@/server/domain/errors";
import type { WeeklyHours } from "@/server/domain/opening-hours";
import type { Settings } from "@/server/domain/types";

import {
  admin,
  allBusy,
  at,
  laundry,
  makeMachines,
  makeSnapshot,
  next,
  runningCycle,
  student,
  T0,
  waiting,
} from "./fixtures";

function expectCode(fn: () => unknown, code: DomainErrorCode) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`Une erreur ${code} était attendue`);
}

const machineStatus = (l: ReturnType<typeof laundry>, id: number) =>
  l.machineList().find((m) => m.id === id)?.status;
const reservationOf = (l: ReturnType<typeof laundry>, studentId: string) =>
  l.activeReservationList().find((r) => r.studentId === studentId);

describe("réservation", () => {
  it("machine libre : l'étudiant est appelé immédiatement, avec 5 minutes pour se présenter", () => {
    const l = laundry(makeSnapshot());
    const r = l.reserve(student("s1"), "s1", 3);
    expect(r.status).toBe("called");
    expect(r.assignedMachineId).toBe(3);
    expect(r.callDeadlineAt).toEqual(at(5));
    expect(machineStatus(l, 3)).toBe("awaiting_student");
    expect(l.changes().notifications).toContainEqual(
      expect.objectContaining({ userId: "s1", kind: "called" }),
    );
    expect(l.changes().logs.map((x) => x.action)).toEqual(["reservation.created", "reservation.called"]);
  });

  it("« première disponible » : prend la première machine libre par numéro", () => {
    const snap = makeSnapshot();
    snap.machines[0]!.status = "out_of_service";
    const l = laundry(snap);
    const r = l.reserve(student("s1"), "s1", null);
    expect(r.assignedMachineId).toBe(2);
  });

  it("toutes les machines occupées : l'étudiant attend en file", () => {
    const l = laundry(makeSnapshot(allBusy()));
    const r = l.reserve(student("s1"), "s1", 1);
    expect(r.status).toBe("waiting");
    expect(r.rank).toBe(1);
    expect(l.reserve(student("s2"), "s2", null).rank).toBe(2);
  });

  it("une seule réservation active par étudiant (paramétrable)", () => {
    const l = laundry(makeSnapshot(allBusy()));
    l.reserve(student("s1"), "s1", 1);
    expectCode(() => l.reserve(student("s1"), "s1", 2), "MAX_ACTIVE_RESERVATIONS");

    const l2 = laundry(makeSnapshot({ ...allBusy(), settings: { maxActiveReservations: 2 } }));
    l2.reserve(student("s1"), "s1", 1);
    expect(l2.reserve(student("s1"), "s1", 2).status).toBe("waiting");
  });

  it("refusée tant que le propre cycle de l'étudiant tourne", () => {
    const busy = allBusy();
    const l = laundry(makeSnapshot(busy));
    expectCode(() => l.reserve(student("busy-1"), "busy-1", 2), "OWN_CYCLE_RUNNING");
  });

  it("refusée en dehors des horaires d'ouverture", () => {
    const l = laundry(makeSnapshot(), new Date("2026-01-14T23:30:00Z")); // 00:30 locale
    expectCode(() => l.reserve(student("s1"), "s1", 1), "LAUNDRY_CLOSED");
  });

  it("refusée sur une machine hors service", () => {
    const snap = makeSnapshot();
    snap.machines[0]!.status = "out_of_service";
    expectCode(() => laundry(snap).reserve(student("s1"), "s1", 1), "MACHINE_OUT_OF_SERVICE");
  });

  it("un étudiant ne peut pas réserver pour un autre ; un admin peut l'ajouter à la file", () => {
    const l = laundry(makeSnapshot(allBusy()));
    expectCode(() => l.reserve(student("s1"), "s2", 1), "FORBIDDEN");
    l.reserve(admin, "s2", 1);
    expect(l.changes().logs[0]).toMatchObject({ action: "queue.added_by_admin", actorId: "admin-1" });
  });
});

describe("appel du suivant à la fin d'un cycle", () => {
  it("la fin du cycle est datée de l'heure prévue, et le suivant est appelé", () => {
    let l = laundry(makeSnapshot(allBusy()));
    l.reserve(student("s1"), "s1", 1); // machine 1 se libère à +10
    l = next(l, at(12)); // traité avec 2 minutes de retard
    expect(l.settle()).toBe(1);
    const cycle = l.changes().cycles[0]!;
    expect(cycle).toMatchObject({ status: "finished", endReason: "completed", actualEndAt: at(10) });
    const r = reservationOf(l, "s1")!;
    expect(r.status).toBe("called");
    expect(r.calledAt).toEqual(at(12));
    expect(r.callDeadlineAt).toEqual(at(17)); // le délai part de l'appel effectif
    expect(l.changes().notifications.map((n) => [n.userId, n.kind])).toEqual([
      ["busy-1", "cycle_finished"],
      ["s1", "called"],
    ]);
  });

  it("respecte l'ordre d'arrivée global entre « première disponible » et réservation ciblée", () => {
    let l = laundry(makeSnapshot(allBusy()));
    l.reserve(student("any"), "any", null); // rang 1
    l.reserve(student("m1"), "m1", 1); // rang 2
    l = next(l, at(10)); // machine 1 se libère
    l.settle();
    expect(reservationOf(l, "any")).toMatchObject({ status: "called", assignedMachineId: 1 });
    expect(reservationOf(l, "m1")?.status).toBe("waiting");
  });

  it("une « première disponible » est attribuée à la première machine qui se libère, quelle qu'elle soit", () => {
    let l = laundry(makeSnapshot(allBusy()));
    l.reserve(student("m1"), "m1", 1);
    l.reserve(student("any"), "any", null);
    l = next(l, at(10)); // machine 1 : m1 (arrivé en premier)
    l.settle();
    expect(reservationOf(l, "m1")?.assignedMachineId).toBe(1);
    expect(reservationOf(l, "any")?.status).toBe("waiting");
    l = next(l, at(11));
    l.confirmPresence(student("m1"), reservationOf(l, "m1")!.id);
    l.startCycle(student("m1"), { machineId: 1, durationMin: 45 });
    l = next(l, at(20)); // machine 2 : any
    l.settle();
    expect(reservationOf(l, "any")).toMatchObject({ status: "called", assignedMachineId: 2 });
  });

  it("si la file est vide, la machine redevient libre", () => {
    let l = laundry(makeSnapshot(allBusy()));
    l = next(l, at(10));
    l.settle();
    expect(machineStatus(l, 1)).toBe("free");
  });
});

describe("délai de présentation et expiration", () => {
  function calledOnMachine1() {
    const l = laundry(makeSnapshot());
    l.reserve(student("s1"), "s1", 1);
    l.reserve(student("s2"), "s2", 1);
    return l;
  }

  it("sans confirmation après 5 minutes : expirée, étudiant prévenu, suivant appelé immédiatement", () => {
    let l = calledOnMachine1();
    l = next(l, at(4));
    expect(l.settle()).toBe(0);
    l = next(l, at(5));
    expect(l.settle()).toBe(1);
    const changes = l.changes();
    expect(changes.reservations.find((r) => r.studentId === "s1")).toMatchObject({
      status: "expired",
      closeReason: "no_show",
      closedAt: at(5),
    });
    expect(reservationOf(l, "s2")).toMatchObject({
      status: "called",
      assignedMachineId: 1,
      callDeadlineAt: at(10),
    });
    expect(machineStatus(l, 1)).toBe("awaiting_student");
    expect(changes.notifications.map((n) => [n.userId, n.kind])).toEqual([
      ["s1", "expired_no_show"],
      ["s2", "called"],
    ]);
  });

  it("« Je suis là » ouvre un second délai de 3 minutes pour lancer le cycle", () => {
    let l = calledOnMachine1();
    l = next(l, at(2));
    const r = reservationOf(l, "s1")!;
    l.confirmPresence(student("s1"), r.id);
    expect(reservationOf(l, "s1")).toMatchObject({ status: "confirmed", confirmDeadlineAt: at(5) });
    l = next(l, at(5));
    l.settle();
    expect(l.changes().reservations.find((x) => x.studentId === "s1")).toMatchObject({
      status: "expired",
      closeReason: "not_started",
    });
    expect(l.changes().notifications[0]).toMatchObject({ userId: "s1", kind: "expired_not_started" });
    expect(reservationOf(l, "s2")?.status).toBe("called");
  });

  it("un étudiant appelé qui annule : le suivant est appelé immédiatement", () => {
    const l = calledOnMachine1();
    l.cancelReservation(student("s1"), reservationOf(l, "s1")!.id);
    expect(reservationOf(l, "s2")).toMatchObject({ status: "called", callDeadlineAt: at(5) });
  });

  it("l'admin peut confirmer la présence à la place de l'étudiant", () => {
    const l = calledOnMachine1();
    l.confirmPresence(admin, reservationOf(l, "s1")!.id);
    expect(reservationOf(l, "s1")?.status).toBe("confirmed");
  });

  it("un étudiant ne peut confirmer ni annuler la réservation d'un autre", () => {
    const l = calledOnMachine1();
    const id = reservationOf(l, "s1")!.id;
    expectCode(() => l.confirmPresence(student("s2"), id), "FORBIDDEN");
    expectCode(() => l.cancelReservation(student("s2"), id), "FORBIDDEN");
  });

  it("on ne peut pas confirmer une réservation encore en attente", () => {
    const l = calledOnMachine1();
    expectCode(() => l.confirmPresence(student("s2"), reservationOf(l, "s2")!.id), "INVALID_TRANSITION");
  });
});

describe("lancement du cycle", () => {
  function confirmedOnMachine1(settings: Partial<Settings> = {}) {
    const l = laundry(makeSnapshot({ settings }));
    l.reserve(student("s1"), "s1", 1);
    l.confirmPresence(student("s1"), reservationOf(l, "s1")!.id);
    return l;
  }

  it("l'étudiant lance son cycle après « Je suis là » ; l'heure de fin est stockée", () => {
    const l = confirmedOnMachine1();
    const cycle = l.startCycle(student("s1"), { machineId: 1, durationMin: 60 });
    expect(cycle).toMatchObject({ studentId: "s1", plannedEndAt: at(60), status: "running" });
    expect(machineStatus(l, 1)).toBe("running");
    expect(l.changes().reservations[0]).toMatchObject({ status: "fulfilled", closeReason: "fulfilled" });
    expect(l.nextDeadline()).toEqual(at(60));
  });

  it("l'étudiant doit choisir une durée proposée", () => {
    expectCode(
      () => confirmedOnMachine1().startCycle(student("s1"), { machineId: 1, durationMin: 50 }),
      "INVALID_DURATION",
    );
  });

  it("l'étudiant ne peut pas lancer sans avoir confirmé", () => {
    const l = laundry(makeSnapshot());
    l.reserve(student("s1"), "s1", 1);
    expectCode(() => l.startCycle(student("s1"), { machineId: 1, durationMin: 45 }), "INVALID_TRANSITION");
  });

  it("paramètre désactivé : seul l'admin lance", () => {
    const l = confirmedOnMachine1({ studentCanStartCycle: false });
    expectCode(() => l.startCycle(student("s1"), { machineId: 1, durationMin: 45 }), "STUDENT_CANNOT_START");
    expect(l.startCycle(admin, { machineId: 1, durationMin: 45 }).studentId).toBe("s1");
  });

  it("un autre étudiant ne peut pas lancer à sa place", () => {
    expectCode(
      () => confirmedOnMachine1().startCycle(student("s2"), { machineId: 1, durationMin: 45 }),
      "FORBIDDEN",
    );
  });

  it("l'admin peut lancer pour un étudiant appelé (présence confirmée au passage), avec une durée libre", () => {
    const l = laundry(makeSnapshot());
    l.reserve(student("s1"), "s1", 1);
    const cycle = l.startCycle(admin, { machineId: 1, durationMin: 50 });
    expect(cycle.plannedDurationMin).toBe(50);
    expect(l.changes().logs.map((x) => x.action)).toContain("reservation.confirmed");
  });

  it("l'admin peut lancer directement sur une machine libre pour un étudiant présent", () => {
    const l = laundry(makeSnapshot());
    expect(l.startCycle(admin, { machineId: 4, durationMin: 30, studentId: "walkin" }).machineId).toBe(4);
    expectCode(() => l.startCycle(admin, { machineId: 4, durationMin: 30, studentId: "x" }), "MACHINE_BUSY");
    expectCode(() => l.startCycle(admin, { machineId: 5, durationMin: 30 }), "INVALID_INPUT");
    expectCode(
      () => l.startCycle(student("s"), { machineId: 5, durationMin: 30, studentId: "s" }),
      "FORBIDDEN",
    );
  });
});

describe("pilotage des cycles par l'admin", () => {
  it("prolonger repousse l'heure de fin stockée", () => {
    const busy = allBusy();
    const l = laundry(makeSnapshot(busy));
    l.extendCycle(admin, "cycle-m1", 15);
    expect(l.runningCycleList().find((c) => c.id === "cycle-m1")?.plannedEndAt).toEqual(at(25));
    expectCode(() => l.extendCycle(admin, "cycle-m1", 0), "INVALID_DURATION");
    expectCode(() => l.extendCycle(student("busy-1"), "cycle-m1", 5), "FORBIDDEN");
  });

  it("terminer plus tôt libère la machine et appelle le suivant", () => {
    const l = laundry(makeSnapshot(allBusy()));
    l.reserve(student("s1"), "s1", 3);
    l.stopCycle(admin, "cycle-m3", "ended_early");
    expect(l.changes().cycles[0]).toMatchObject({
      status: "finished",
      endReason: "ended_early",
      actualEndAt: T0,
    });
    expect(reservationOf(l, "s1")).toMatchObject({ status: "called", assignedMachineId: 3 });
  });

  it("annuler un cycle le marque annulé", () => {
    const l = laundry(makeSnapshot(allBusy()));
    l.stopCycle(admin, "cycle-m2", "cancelled");
    expect(l.changes().cycles[0]).toMatchObject({ status: "cancelled", endReason: "cancelled" });
    expect(machineStatus(l, 2)).toBe("free");
  });
});

describe("machine hors service", () => {
  it("refusé pendant un cycle", () => {
    expectCode(() => laundry(makeSnapshot(allBusy())).disableMachine(admin, 1), "MACHINE_BUSY");
  });

  it("prévient les étudiants de la file et leur permet de basculer en « première disponible »", () => {
    const busy = allBusy();
    let l = laundry(makeSnapshot(busy));
    l.reserve(student("s1"), "s1", 1);
    l.reserve(student("s2"), "s2", 1);
    l = next(l, at(10)); // machine 1 libre → s1 appelé
    l.settle();
    expect(reservationOf(l, "s1")?.status).toBe("called");

    l = next(l, at(11));
    l.disableMachine(admin, 1);
    expect(machineStatus(l, 1)).toBe("out_of_service");
    // L'étudiant appelé retourne en attente en gardant sa place
    expect(reservationOf(l, "s1")).toMatchObject({ status: "waiting", assignedMachineId: null, rank: 1 });
    expect(reservationOf(l, "s1")?.notice).toBe("machine_out_of_service");
    expect(reservationOf(l, "s2")?.notice).toBe("machine_out_of_service");
    expect(l.changes().notifications.filter((n) => n.kind === "machine_out_of_service")).toHaveLength(2);

    // s2 bascule ; la machine 2 se libère → s2 est servi avant s1 (resté sur la machine 1 hors service)
    l = next(l, at(12));
    l.switchToFirstAvailable(student("s2"), reservationOf(l, "s2")!.id);
    expect(reservationOf(l, "s2")).toMatchObject({ targetMachineId: null, notice: null });
    l = next(l, at(20));
    l.settle();
    expect(reservationOf(l, "s2")).toMatchObject({ status: "called", assignedMachineId: 2 });

    // Remise en service : s1 est prévenu et appelé
    l = next(l, at(21));
    l.enableMachine(admin, 1);
    expect(reservationOf(l, "s1")).toMatchObject({ status: "called", assignedMachineId: 1, notice: null });
  });

  it("l'étudiant appelé qui revient en file garde un rang unique", () => {
    const l = laundry(makeSnapshot({ machines: makeMachines(1) }));
    const first = l.reserve(student("s1"), "s1", 1); // appelé, rang 1
    const second = l.reserve(student("s2"), "s2", 1); // en attente
    expect(second.rank).toBeGreaterThan(first.rank);
    l.disableMachine(admin, 1);
    const ranks = l.activeReservationList().map((r) => r.rank);
    expect(new Set(ranks).size).toBe(2);
    expect(l.activeReservationList().map((r) => r.studentId)).toEqual(["s1", "s2"]);
  });

  it("aucune réservation possible sur une machine hors service ; transitions refusées", () => {
    const l = laundry(makeSnapshot());
    l.disableMachine(admin, 2);
    expectCode(() => l.disableMachine(admin, 2), "INVALID_TRANSITION");
    expectCode(
      () => l.startCycle(admin, { machineId: 2, durationMin: 30, studentId: "x" }),
      "MACHINE_OUT_OF_SERVICE",
    );
    expectCode(() => l.enableMachine(student("s1"), 2), "FORBIDDEN");
  });
});

describe("horaires d'ouverture", () => {
  it("à la fermeture, les réservations en file sont annulées et les étudiants prévenus", () => {
    let l = laundry(makeSnapshot(allBusy()), new Date("2026-01-14T21:30:00Z")); // 22:30 locale
    l.reserve(student("s1"), "s1", 1);
    l = next(l, new Date("2026-01-14T22:00:30Z")); // 23:00:30 locale
    l.settle();
    const changes = l.changes();
    expect(changes.reservations.find((r) => r.studentId === "s1")).toMatchObject({
      status: "cancelled",
      closeReason: "laundry_closed",
      closedAt: new Date("2026-01-14T22:00:00Z"),
    });
    expect(changes.notifications).toContainEqual(
      expect.objectContaining({ userId: "s1", kind: "cancelled_laundry_closed" }),
    );
  });

  it("horaires modifiés : une file qui existe pendant la fermeture est annulée, personne n'est appelé", () => {
    const hours: WeeklyHours = Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((d) => [d, { openMinute: 0, closeMinute: 23 * 60 }]),
    );
    const l = laundry(
      makeSnapshot({
        hours,
        activeReservations: [
          waiting({ id: "r", studentId: "s1", createdAt: new Date("2026-01-14T22:30:00Z") }),
        ],
      }),
      new Date("2026-01-14T22:45:00Z"), // 23:45 locale, fermé
    );
    l.settle();
    expect(l.changes().reservations[0]).toMatchObject({ status: "cancelled", closeReason: "laundry_closed" });
    expect(l.changes().notifications.map((n) => n.kind)).toEqual(["cancelled_laundry_closed"]);
    expect(machineStatus(l, 1)).toBe("free");
  });
});

describe("rattrapage après une interruption (aucune requête pendant longtemps)", () => {
  it("traite toutes les échéances dans l'ordre chronologique", () => {
    let l = laundry(
      makeSnapshot({
        machines: makeMachines(1).map((m) => ({ ...m, status: "running" as const })),
        runningCycles: [runningCycle({ machineId: 1, studentId: "x", plannedEndAt: at(10) })],
      }),
    );
    l.reserve(student("s1"), "s1", 1);
    l.reserve(student("s2"), "s2", 1);
    // Personne ne consulte la plateforme pendant 1 heure.
    l = next(l, at(70));
    expect(l.settle()).toBe(1); // fin du cycle à +10 ; s1 appelé maintenant
    expect(l.changes().cycles[0]?.actualEndAt).toEqual(at(10));
    expect(reservationOf(l, "s1")).toMatchObject({ status: "called", callDeadlineAt: at(75) });
    // s1 n'est pas éliminé « dans le passé » sans avoir été prévenu
    expect(reservationOf(l, "s2")?.status).toBe("waiting");
  });

  it("idempotent : un second passage ne fait rien", () => {
    let l = laundry(makeSnapshot(allBusy()));
    l = next(l, at(100));
    expect(l.settle()).toBe(7);
    l = next(l, at(100));
    expect(l.settle()).toBe(0);
    expect(l.hasChanges()).toBe(false);
  });
});

describe("réordonner la file (admin)", () => {
  it("place une réservation avant une autre", () => {
    const l = laundry(makeSnapshot(allBusy()));
    const a = l.reserve(student("a"), "a", 1);
    l.reserve(student("b"), "b", 1);
    const c = l.reserve(student("c"), "c", 1);
    l.moveReservation(admin, c.id, a.id);
    expect(l.activeReservationList().map((r) => r.studentId)).toEqual(["c", "a", "b"]);
    l.moveReservation(admin, c.id, null);
    expect(l.activeReservationList().map((r) => r.studentId)).toEqual(["a", "b", "c"]);
    expectCode(() => l.moveReservation(student("a"), a.id, null), "FORBIDDEN");
  });

  it("renumérote quand les rangs deviennent trop proches", () => {
    const l = laundry(makeSnapshot(allBusy()));
    const ids = ["a", "b", "c"].map((s) => l.reserve(student(s), s, 1).id);
    for (let i = 0; i < 60; i++) l.moveReservation(admin, i % 2 ? ids[0]! : ids[2]!, ids[1]!);
    const ranks = l.activeReservationList().map((r) => r.rank);
    expect(new Set(ranks).size).toBe(3);
    expect(l.activeReservationList()).toHaveLength(3);
  });
});

describe("prochaine échéance", () => {
  it("la plus proche entre fin de cycle, délai de présentation et fermeture", () => {
    const l = laundry(makeSnapshot(allBusy()));
    expect(l.nextDeadline()).toEqual(at(10));
    l.stopCycle(admin, "cycle-m1", "cancelled");
    l.reserve(student("s1"), "s1", 1);
    expect(l.nextDeadline()).toEqual(at(5)); // délai de présentation
  });

  it("aucune échéance quand tout est libre", () => {
    expect(laundry(makeSnapshot()).nextDeadline()).toBeNull();
  });

  it("file en attente : la fermeture du jour est une échéance", () => {
    const now = new Date("2026-01-14T21:50:00Z"); // 22:50 locale
    const machines = makeMachines(1).map((m) => ({ ...m, status: "running" as const }));
    const runningCycles = [
      runningCycle({ machineId: 1, studentId: "x", plannedEndAt: new Date("2026-01-14T22:30:00Z") }),
    ];
    const l = laundry(makeSnapshot({ machines, runningCycles }), now);
    l.reserve(student("s1"), "s1", 1);
    expect(l.nextDeadline()).toEqual(new Date("2026-01-14T22:00:00Z")); // 23:00 locale
  });
});
