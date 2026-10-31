import { addMinutes } from "@/lib/time";

import { waitingInOrder } from "./queue";
import type { Cycle, Machine, Reservation } from "./types";

export interface Estimates {
  /** Heure estimée de disponibilité pour chaque réservation en attente (`null` si impossible à estimer). */
  byReservation: Map<string, { at: Date | null; machineId: number | null }>;
  /** Heure à laquelle chaque machine devrait être disponible pour la prochaine personne de sa file. */
  machineFreeAt: Map<number, Date | null>;
}

/**
 * Estime l'heure de disponibilité de chaque réservation en attente.
 *
 * Règle : fin du cycle en cours (ou, si quelqu'un est appelé, maintenant + durée par
 * défaut de son cycle) + durées par défaut des cycles des étudiants placés devant.
 *
 * On simule la file dans l'ordre global : une réservation ciblée occupe sa machine ;
 * une réservation « première disponible » occupe la machine qui se libère le plus tôt
 * (à égalité, le plus petit numéro). Une machine hors service ne libère jamais de place.
 */
export function computeEstimates(input: {
  machines: Machine[];
  runningCycles: Cycle[];
  activeReservations: Reservation[];
  now: Date;
}): Estimates {
  const { machines, runningCycles, activeReservations, now } = input;
  const freeAt = new Map<number, Date | null>();

  for (const m of machines) {
    switch (m.status) {
      case "out_of_service":
        freeAt.set(m.id, null);
        break;
      case "running": {
        const cycle = runningCycles.find((c) => c.machineId === m.id && c.status === "running");
        freeAt.set(m.id, cycle ? maxDate(cycle.plannedEndAt, now) : now);
        break;
      }
      case "awaiting_student":
        freeAt.set(m.id, addMinutes(now, m.defaultDurationMin));
        break;
      case "free":
        freeAt.set(m.id, now);
        break;
    }
  }
  const machineFreeAt = new Map(freeAt);

  const byId = new Map(machines.map((m) => [m.id, m]));
  const byReservation: Estimates["byReservation"] = new Map();

  for (const r of waitingInOrder(activeReservations)) {
    let machineId: number | null = r.targetMachineId;
    if (machineId === null) {
      let best: { id: number; at: Date; number: number } | null = null;
      for (const m of machines) {
        const at = freeAt.get(m.id);
        if (!at) continue;
        if (!best || at < best.at || (at.getTime() === best.at.getTime() && m.number < best.number)) {
          best = { id: m.id, at, number: m.number };
        }
      }
      machineId = best?.id ?? null;
    }
    const machine = machineId === null ? undefined : byId.get(machineId);
    const at = machine ? (freeAt.get(machine.id) ?? null) : null;
    byReservation.set(r.id, { at, machineId: at ? (machineId ?? null) : null });
    if (machine && at) freeAt.set(machine.id, addMinutes(at, machine.defaultDurationMin));
  }

  return { byReservation, machineFreeAt };
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}
