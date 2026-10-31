import { describe, expect, it } from "vitest";

import {
  machineQueue,
  pickNextForMachine,
  positionOf,
  rankBefore,
  waitingInOrder,
} from "@/server/domain/queue";

import { at, waiting } from "./fixtures";

describe("file d'attente", () => {
  const a = waiting({ id: "a", studentId: "s1", rank: 1, targetMachineId: null }); // première dispo
  const b = waiting({ id: "b", studentId: "s2", rank: 2, targetMachineId: 1 });
  const c = waiting({ id: "c", studentId: "s3", rank: 3, targetMachineId: 2 });
  const d = waiting({ id: "d", studentId: "s4", rank: 4, targetMachineId: 1 });
  const all = [d, c, b, a];

  it("trie par ordre d'arrivée global", () => {
    expect(waitingInOrder(all).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("ordre total à rang égal : date de création puis identifiant", () => {
    const x = waiting({ id: "x", studentId: "s", rank: 5, createdAt: at(2) });
    const y = waiting({ id: "y", studentId: "s", rank: 5, createdAt: at(1) });
    expect(waitingInOrder([x, y]).map((r) => r.id)).toEqual(["y", "x"]);
  });

  it("la file d'une machine contient ses réservations et les « première disponible »", () => {
    expect(machineQueue(1, all).map((r) => r.id)).toEqual(["a", "b", "d"]);
    expect(machineQueue(2, all).map((r) => r.id)).toEqual(["a", "c"]);
    expect(machineQueue(3, all).map((r) => r.id)).toEqual(["a"]);
  });

  it("une « première disponible » plus ancienne passe avant une réservation ciblée", () => {
    expect(pickNextForMachine(1, all)?.id).toBe("a");
    expect(pickNextForMachine(1, [b, d])?.id).toBe("b");
    expect(pickNextForMachine(5, [b, c, d])).toBeNull();
  });

  it("ignore les réservations qui ne sont plus en attente", () => {
    const called = { ...a, status: "called" as const };
    expect(pickNextForMachine(1, [called, b])?.id).toBe("b");
  });

  it("position affichée", () => {
    expect(positionOf(a, all)).toBe(1);
    expect(positionOf(d, all)).toBe(3); // file de la machine 1 : a, b, d
    expect(positionOf(c, all)).toBe(2); // file de la machine 2 : a, c
  });

  it("calcule un rang intermédiaire, ou demande une renumérotation", () => {
    const ordered = waitingInOrder(all);
    expect(rankBefore(ordered, c)).toBe(2.5);
    expect(rankBefore(ordered, a)).toBe(0);
    expect(rankBefore(ordered, null)).toBe(5);
    const tight = [
      waiting({ id: "p", studentId: "s", rank: 1 }),
      waiting({ id: "q", studentId: "s", rank: 1 + 1e-7 }),
    ];
    expect(rankBefore(tight, tight[1]!)).toBeNull();
  });
});
