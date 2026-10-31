/**
 * Synchronisation des clients (rafraîchissement automatique de la page).
 *
 * Chemin le plus fréquent — rien n'a changé : `pollHead` fait UNE SEULE requête SQL
 * (session + utilisateur + version + prochaine échéance) et l'API répond 304 sans corps.
 * Sinon, `buildState` construit l'état complet dans une transaction en lecture seule
 * (REPEATABLE READ), pour que toutes les données viennent du même instant.
 */
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { TIME_ZONE } from "@/i18n/config";
import type {
  CallView,
  CycleView,
  LaundryStateView,
  MachineView,
  MyReservationView,
  QueueEntryView,
  StudentRef,
} from "@/lib/state-types";

import { hashToken } from "../auth/session";
import { now as clockNow } from "../clock";
import { getDb } from "../db/client";
import { laundryState, notifications, reservations, sessions, users } from "../db/schema";
import { computeEstimates } from "../domain/estimate";
import { currentPeriod, nextOpeningAfter } from "../domain/opening-hours";
import { machineQueue, positionOf } from "../domain/queue";
import type { LaundrySnapshot, Reservation, Role } from "../domain/types";

import { loadSnapshot } from "./laundry-tx";

export interface PollHead {
  version: number;
  nextDeadlineAt: Date | null;
  viewer: {
    id: string;
    role: Role;
    firstName: string;
    lastName: string;
    mustChangePassword: boolean;
    sessionExpiresAt: Date;
  } | null;
}

/** Une seule requête : état de synchronisation + session valide + compte actif. */
export async function pollHead(token: string | undefined, at: Date): Promise<PollHead> {
  const sessionId = token && token.length <= 100 ? hashToken(token) : "";
  const [row] = await getDb()
    .select({
      version: laundryState.version,
      nextDeadlineAt: laundryState.nextDeadlineAt,
      userId: users.id,
      role: users.role,
      firstName: users.firstName,
      lastName: users.lastName,
      mustChangePassword: users.mustChangePassword,
      sessionExpiresAt: sessions.expiresAt,
    })
    .from(laundryState)
    .leftJoin(sessions, and(eq(sessions.id, sessionId), gt(sessions.expiresAt, at)))
    .leftJoin(users, and(eq(users.id, sessions.userId), eq(users.status, "active")))
    .where(eq(laundryState.id, 1));
  if (!row) throw new Error("laundry_state absent : lancez les migrations");
  return {
    version: row.version,
    nextDeadlineAt: row.nextDeadlineAt,
    viewer:
      row.userId && row.role && row.sessionExpiresAt
        ? {
            id: row.userId,
            role: row.role,
            firstName: row.firstName ?? "",
            lastName: row.lastName ?? "",
            mustChangePassword: row.mustChangePassword ?? false,
            sessionExpiresAt: row.sessionExpiresAt,
          }
        : null,
  };
}

/** Prolonge la session glissante (au plus une écriture tous les 15 jours). */
export async function renewSessionIfNeeded(token: string, expiresAt: Date, at: Date): Promise<void> {
  const DAY = 86_400_000;
  if (expiresAt.getTime() - at.getTime() >= 15 * DAY) return;
  await getDb()
    .update(sessions)
    .set({ expiresAt: new Date(at.getTime() + 30 * DAY) })
    .where(eq(sessions.id, hashToken(token)));
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Estimation pour une réservation hypothétique ajoutée en fin de file. */
function virtualEstimate(snapshot: LaundrySnapshot, at: Date, targetMachineId: number | null): Date | null {
  const maxRank = Math.max(0, ...snapshot.activeReservations.map((r) => r.rank));
  const virtual: Reservation = {
    id: "__virtual__",
    studentId: "__virtual__",
    targetMachineId,
    assignedMachineId: null,
    rank: maxRank + 1,
    status: "waiting",
    createdAt: at,
    calledAt: null,
    callDeadlineAt: null,
    confirmedAt: null,
    confirmDeadlineAt: null,
    closedAt: null,
    closeReason: null,
    notice: null,
  };
  const e = computeEstimates({
    machines: snapshot.machines,
    runningCycles: snapshot.runningCycles,
    activeReservations: [...snapshot.activeReservations, virtual],
    now: at,
  });
  return e.byReservation.get(virtual.id)?.at ?? null;
}

export async function buildState(viewer: NonNullable<PollHead["viewer"]>): Promise<LaundryStateView> {
  const at = clockNow();
  const isAdmin = viewer.role === "admin";

  return getDb().transaction(
    async (tx) => {
      const [[state], snapshot] = await Promise.all([
        tx.select({ version: laundryState.version }).from(laundryState).where(eq(laundryState.id, 1)),
        loadSnapshot(tx),
      ]);

      const studentIds = new Set<string>();
      for (const c of snapshot.runningCycles) studentIds.add(c.studentId);
      for (const r of snapshot.activeReservations) studentIds.add(r.studentId);
      if (!isAdmin) {
        // Un étudiant ne voit que sa propre identité.
        for (const id of [...studentIds]) if (id !== viewer.id) studentIds.delete(id);
      }

      const settings = snapshot.settings;
      const since = new Date(at.getTime() - settings.noShowWindowDays * 86_400_000);
      const [people, unread, noShows] = await Promise.all([
        studentIds.size
          ? tx
              .select({
                id: users.id,
                firstName: users.firstName,
                lastName: users.lastName,
                room: users.room,
                schoolId: users.schoolId,
              })
              .from(users)
              .where(inArray(users.id, [...studentIds]))
          : Promise.resolve([]),
        tx
          .select({
            id: notifications.id,
            kind: notifications.kind,
            details: notifications.details,
            createdAt: notifications.createdAt,
          })
          .from(notifications)
          .where(and(eq(notifications.userId, viewer.id), isNull(notifications.readAt)))
          .orderBy(notifications.id)
          .limit(20),
        isAdmin && studentIds.size
          ? tx
              .select({ studentId: reservations.studentId, n: sql<number>`count(*)::int` })
              .from(reservations)
              .where(
                and(
                  eq(reservations.closeReason, "no_show"),
                  gt(reservations.closedAt, since),
                  inArray(reservations.studentId, [...studentIds]),
                ),
              )
              .groupBy(reservations.studentId)
          : Promise.resolve([]),
      ]);

      const noShowBy = new Map(noShows.map((x) => [x.studentId, Number(x.n)]));
      const refs = new Map<string, StudentRef>(
        people.map((p) => {
          const ref: StudentRef = { ...p };
          if (isAdmin) {
            ref.noShowCount = noShowBy.get(p.id) ?? 0;
            ref.noShowWarning = ref.noShowCount >= settings.noShowWarningThreshold;
          }
          return [p.id, ref];
        }),
      );
      const ref = (id: string) => refs.get(id) ?? null;

      const estimates = computeEstimates({
        machines: snapshot.machines,
        runningCycles: snapshot.runningCycles,
        activeReservations: snapshot.activeReservations,
        now: at,
      });
      const byNumber = new Map(snapshot.machines.map((m) => [m.id, m.number]));

      const machines: MachineView[] = snapshot.machines.map((m) => {
        const c = snapshot.runningCycles.find((x) => x.machineId === m.id);
        const cycle: CycleView | null = c
          ? {
              id: c.id,
              startedAt: c.startedAt.toISOString(),
              plannedDurationMin: c.plannedDurationMin,
              plannedEndAt: c.plannedEndAt.toISOString(),
              isMine: c.studentId === viewer.id,
              student: ref(c.studentId),
            }
          : null;
        const called = snapshot.activeReservations.find(
          (r) => r.assignedMachineId === m.id && (r.status === "called" || r.status === "confirmed"),
        );
        const deadline = called?.status === "confirmed" ? called.confirmDeadlineAt : called?.callDeadlineAt;
        const call: CallView | null =
          called && called.calledAt && deadline
            ? {
                reservationId: called.id,
                status: called.status as "called" | "confirmed",
                calledAt: called.calledAt.toISOString(),
                deadlineAt: deadline.toISOString(),
                isMine: called.studentId === viewer.id,
                student: ref(called.studentId),
              }
            : null;
        const queue: QueueEntryView[] = machineQueue(m.id, snapshot.activeReservations).map((r, i) => ({
          reservationId: r.id,
          position: i + 1,
          estimatedAt: iso(estimates.byReservation.get(r.id)?.at),
          isAny: r.targetMachineId === null,
          isMine: r.studentId === viewer.id,
          notice: r.notice,
          student: ref(r.studentId),
        }));
        return {
          id: m.id,
          number: m.number,
          name: m.name,
          status: m.status,
          defaultDurationMin: m.defaultDurationMin,
          cycle,
          call,
          queue,
          newReservationEstimateAt:
            m.status === "out_of_service" ? null : iso(virtualEstimate(snapshot, at, m.id)),
        };
      });

      const mine: MyReservationView[] = snapshot.activeReservations
        .filter((r) => r.studentId === viewer.id)
        .map((r) => {
          const e = estimates.byReservation.get(r.id);
          const deadline =
            r.status === "confirmed" ? r.confirmDeadlineAt : r.status === "called" ? r.callDeadlineAt : null;
          return {
            id: r.id,
            status: r.status as MyReservationView["status"],
            targetMachineNumber:
              r.targetMachineId === null ? null : (byNumber.get(r.targetMachineId) ?? null),
            assignedMachineNumber:
              r.assignedMachineId === null ? null : (byNumber.get(r.assignedMachineId) ?? null),
            assignedMachineId: r.assignedMachineId,
            position: positionOf(r, snapshot.activeReservations),
            estimatedAt: iso(e?.at),
            estimatedMachineNumber: e?.machineId ? (byNumber.get(e.machineId) ?? null) : null,
            calledAt: iso(r.calledAt),
            deadlineAt: iso(deadline),
            notice: r.notice,
            createdAt: r.createdAt.toISOString(),
          };
        });

      const myCycle = snapshot.runningCycles.find((c) => c.studentId === viewer.id);
      const period = currentPeriod(snapshot.hours, at, TIME_ZONE);
      const shortest = virtualEstimate(snapshot, at, null);

      return {
        version: state!.version,
        serverNow: at.toISOString(),
        viewer: { id: viewer.id, role: viewer.role, firstName: viewer.firstName, lastName: viewer.lastName },
        laundry: {
          open: period !== null,
          closesAt: iso(period?.closesAt),
          nextOpeningAt: iso(period ? null : nextOpeningAfter(snapshot.hours, at, TIME_ZONE)),
        },
        settings: {
          callDelayMin: settings.callDelayMin,
          confirmDelayMin: settings.confirmDelayMin,
          cycleDurationsMin: settings.cycleDurationsMin,
          studentCanStartCycle: settings.studentCanStartCycle,
          maxActiveReservations: settings.maxActiveReservations,
        },
        summary: {
          freeCount: snapshot.machines.filter((m) => m.status === "free").length,
          shortestWaitMin: shortest
            ? Math.max(0, Math.ceil((shortest.getTime() - at.getTime()) / 60_000))
            : null,
          shortestWaitAt: iso(shortest),
        },
        machines,
        me: {
          reservations: mine,
          cycle: myCycle
            ? {
                id: myCycle.id,
                machineNumber: byNumber.get(myCycle.machineId) ?? 0,
                startedAt: myCycle.startedAt.toISOString(),
                plannedEndAt: myCycle.plannedEndAt.toISOString(),
                plannedDurationMin: myCycle.plannedDurationMin,
              }
            : null,
          notifications: unread.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
        },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
