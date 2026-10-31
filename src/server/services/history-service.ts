import { and, desc, eq, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { AuthUser } from "../auth/session";
import { getDb } from "../db/client";
import { activityLog, cycles, machines, notifications, reservations, users } from "../db/schema";

/** Historique personnel : réservations (tous statuts) et cycles. */
export async function myHistory(user: AuthUser, limit = 50) {
  const db = getDb();
  const target = alias(machines, "target");
  const assigned = alias(machines, "assigned");
  const [resRows, cycleRows] = await Promise.all([
    db
      .select({
        id: reservations.id,
        status: reservations.status,
        targetMachineNumber: target.number,
        assignedMachineNumber: assigned.number,
        createdAt: reservations.createdAt,
        calledAt: reservations.calledAt,
        closedAt: reservations.closedAt,
        closeReason: reservations.closeReason,
      })
      .from(reservations)
      .leftJoin(target, eq(target.id, reservations.targetMachineId))
      .leftJoin(assigned, eq(assigned.id, reservations.assignedMachineId))
      .where(eq(reservations.studentId, user.id))
      .orderBy(desc(reservations.createdAt))
      .limit(limit),
    db
      .select({
        id: cycles.id,
        machineNumber: machines.number,
        startedAt: cycles.startedAt,
        plannedDurationMin: cycles.plannedDurationMin,
        plannedEndAt: cycles.plannedEndAt,
        actualEndAt: cycles.actualEndAt,
        status: cycles.status,
        endReason: cycles.endReason,
      })
      .from(cycles)
      .innerJoin(machines, eq(machines.id, cycles.machineId))
      .where(eq(cycles.studentId, user.id))
      .orderBy(desc(cycles.startedAt))
      .limit(limit),
  ]);
  return { reservations: resRows, cycles: cycleRows };
}

/** Journal d'activité (admin), paginé par identifiant décroissant. */
export async function activity(opts: {
  limit: number;
  beforeId?: number | undefined;
  action?: string | undefined;
}) {
  const rows = await getDb()
    .select({
      id: activityLog.id,
      at: activityLog.at,
      action: activityLog.action,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      details: activityLog.details,
      actorId: activityLog.actorId,
      actorName: sql<string | null>`${users.firstName} || ' ' || ${users.lastName}`,
      actorRole: users.role,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.actorId))
    .where(
      and(
        opts.beforeId ? lt(activityLog.id, opts.beforeId) : undefined,
        opts.action ? sql`${activityLog.action} like ${opts.action.replace(/[%_]/g, "") + "%"}` : undefined,
      ),
    )
    .orderBy(desc(activityLog.id))
    .limit(opts.limit);
  return { entries: rows, nextBeforeId: rows.length === opts.limit ? rows.at(-1)?.id : null };
}

export async function unreadNotifications(userId: string) {
  return getDb()
    .select({
      id: notifications.id,
      kind: notifications.kind,
      details: notifications.details,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), sql`${notifications.readAt} is null`))
    .orderBy(desc(notifications.id))
    .limit(20);
}

export async function markNotificationsRead(userId: string, upToId: number, at: Date) {
  await getDb()
    .update(notifications)
    .set({ readAt: at })
    .where(
      and(
        eq(notifications.userId, userId),
        sql`${notifications.id} <= ${upToId}`,
        sql`${notifications.readAt} is null`,
      ),
    );
  return { ok: true };
}
