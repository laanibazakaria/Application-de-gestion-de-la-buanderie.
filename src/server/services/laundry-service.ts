/**
 * Actions sur les machines, cycles et files. Chacune s'exécute dans `withLaundry`
 * (verrou global + échéances traitées avant l'action). Les contrôles de droits
 * sont faits par la route ET par le moteur (défense en profondeur).
 */
import { and, eq } from "drizzle-orm";

import type { AuthUser } from "../auth/session";
import { machines, users } from "../db/schema";
import { DomainError } from "../domain/errors";
import type { Actor } from "../domain/types";

import { withLaundry, type Tx } from "./laundry-tx";

export function actorOf(user: AuthUser): Actor {
  return { kind: "user", id: user.id, role: user.role };
}

async function requireActiveStudent(tx: Tx, studentId: string): Promise<void> {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student"), eq(users.status, "active")));
  if (!row) throw new DomainError("NOT_FOUND", "Étudiant introuvable ou suspendu");
}

export function reserve(user: AuthUser, targetMachineId: number | null) {
  return withLaundry(({ engine }) => {
    const r = engine.reserve(actorOf(user), user.id, targetMachineId);
    return { reservationId: r.id, status: r.status };
  });
}

export function enqueueStudent(admin: AuthUser, studentId: string, targetMachineId: number | null) {
  return withLaundry(async ({ engine, tx }) => {
    await requireActiveStudent(tx, studentId);
    const r = engine.reserve(actorOf(admin), studentId, targetMachineId);
    return { reservationId: r.id, status: r.status };
  });
}

export function cancelReservation(user: AuthUser, reservationId: string) {
  return withLaundry(({ engine }) => {
    engine.cancelReservation(actorOf(user), reservationId);
    return { ok: true };
  });
}

export function confirmPresence(user: AuthUser, reservationId: string) {
  return withLaundry(({ engine }) => {
    engine.confirmPresence(actorOf(user), reservationId);
    return { ok: true };
  });
}

export function switchToFirstAvailable(user: AuthUser, reservationId: string) {
  return withLaundry(({ engine }) => {
    engine.switchToFirstAvailable(actorOf(user), reservationId);
    return { ok: true };
  });
}

export function moveReservation(admin: AuthUser, reservationId: string, beforeId: string | null) {
  return withLaundry(({ engine }) => {
    engine.moveReservation(actorOf(admin), reservationId, beforeId);
    return { ok: true };
  });
}

export function startCycle(
  user: AuthUser,
  input: { machineId: number; durationMin: number; studentId?: string },
) {
  return withLaundry(async ({ engine, tx }) => {
    if (user.role !== "admin" && input.studentId && input.studentId !== user.id)
      throw new DomainError("FORBIDDEN");
    if (user.role === "admin" && input.studentId) await requireActiveStudent(tx, input.studentId);
    const cycle = engine.startCycle(actorOf(user), input);
    return { cycleId: cycle.id, plannedEndAt: cycle.plannedEndAt.toISOString() };
  });
}

export function extendCycle(admin: AuthUser, cycleId: string, minutes: number) {
  return withLaundry(({ engine }) => {
    engine.extendCycle(actorOf(admin), cycleId, minutes);
    return { ok: true };
  });
}

export function stopCycle(admin: AuthUser, cycleId: string, mode: "ended_early" | "cancelled") {
  return withLaundry(({ engine }) => {
    engine.stopCycle(actorOf(admin), cycleId, mode);
    return { ok: true };
  });
}

export function disableMachine(admin: AuthUser, machineId: number) {
  return withLaundry(({ engine }) => {
    engine.disableMachine(actorOf(admin), machineId);
    return { ok: true };
  });
}

export function enableMachine(admin: AuthUser, machineId: number) {
  return withLaundry(({ engine }) => {
    engine.enableMachine(actorOf(admin), machineId);
    return { ok: true };
  });
}

/** Nom et durée par défaut d'une machine (hors machine à états). */
export function updateMachine(
  admin: AuthUser,
  machineId: number,
  patch: { name?: string; defaultDurationMin?: number },
) {
  return withLaundry(async ({ tx, now, log }) => {
    const [row] = await tx
      .update(machines)
      .set({ ...patch, updatedAt: now })
      .where(eq(machines.id, machineId))
      .returning({ id: machines.id });
    if (!row) throw new DomainError("NOT_FOUND");
    log({
      action: "machine.updated",
      actorId: admin.id,
      entityType: "machine",
      entityId: String(machineId),
      details: patch,
    });
    return { ok: true };
  });
}
