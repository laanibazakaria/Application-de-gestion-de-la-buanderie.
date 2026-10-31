import { randomUUID } from "node:crypto";

import { asc, eq, inArray, sql } from "drizzle-orm";

import { TIME_ZONE } from "@/i18n/config";

import { now as clockNow } from "../clock";
import { getDb, type Database } from "../db/client";
import * as t from "../db/schema";
import { Laundry } from "../domain/laundry";
import type { WeeklyHours } from "../domain/opening-hours";
import { ACTIVE_RESERVATION_STATUSES } from "../domain/reservation-state";
import type { Cycle, LaundrySnapshot, LogEntry, Machine, Reservation, Settings } from "../domain/types";

/** Transaction Drizzle (même API que la base). */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Clé du verrou consultatif global. Toutes les transactions qui modifient les
 * machines, cycles ou files le prennent : elles s'exécutent donc l'une après
 * l'autre, ce qui élimine toute course entre deux réservations simultanées.
 * Le volume (quelques centaines d'actions par jour) rend ce choix sans coût.
 */
const LAUNDRY_LOCK_KEY = 7_331_001;

export async function lockLaundry(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${LAUNDRY_LOCK_KEY})`);
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------

export async function loadSettings(tx: Tx | Database): Promise<Settings> {
  const [row] = await tx.select().from(t.settings).where(eq(t.settings.id, 1));
  if (!row) throw new Error("Paramètres absents : lancez les migrations");
  return {
    callDelayMin: row.callDelayMin,
    confirmDelayMin: row.confirmDelayMin,
    cycleDurationsMin: [...row.cycleDurationsMin].sort((a, b) => a - b),
    maxActiveReservations: row.maxActiveReservations,
    studentCanStartCycle: row.studentCanStartCycle,
    noShowWarningThreshold: row.noShowWarningThreshold,
    noShowWindowDays: row.noShowWindowDays,
  };
}

export async function loadHours(tx: Tx | Database): Promise<WeeklyHours> {
  const rows = await tx.select().from(t.openingHours);
  const hours: Record<number, { openMinute: number; closeMinute: number } | null> = {};
  for (let d = 1; d <= 7; d++) hours[d] = null;
  for (const r of rows)
    hours[r.weekday] = r.isOpen ? { openMinute: r.openMinute, closeMinute: r.closeMinute } : null;
  return hours;
}

export async function loadSnapshot(tx: Tx | Database): Promise<LaundrySnapshot> {
  // Requêtes en séquence : une transaction n'a qu'une connexion, qui les exécute de toute façon l'une après l'autre.
  const machineRows = await tx.select().from(t.machines).orderBy(asc(t.machines.number));
  const cycleRows = await tx.select().from(t.cycles).where(eq(t.cycles.status, "running"));
  const reservationRows = await tx
    .select()
    .from(t.reservations)
    .where(inArray(t.reservations.status, [...ACTIVE_RESERVATION_STATUSES]));
  const settings = await loadSettings(tx);
  const hours = await loadHours(tx);
  return {
    machines: machineRows.map((m): Machine => ({
      id: m.id,
      number: m.number,
      name: m.name,
      status: m.status,
      defaultDurationMin: m.defaultDurationMin,
    })),
    runningCycles: cycleRows.map((c): Cycle => ({
      id: c.id,
      machineId: c.machineId,
      studentId: c.studentId,
      reservationId: c.reservationId,
      startedAt: c.startedAt,
      plannedDurationMin: c.plannedDurationMin,
      plannedEndAt: c.plannedEndAt,
      actualEndAt: c.actualEndAt,
      status: c.status,
      endReason: c.endReason,
    })),
    activeReservations: reservationRows.map((r): Reservation => ({
      id: r.id,
      studentId: r.studentId,
      targetMachineId: r.targetMachineId,
      assignedMachineId: r.assignedMachineId,
      rank: r.rank,
      status: r.status,
      createdAt: r.createdAt,
      calledAt: r.calledAt,
      callDeadlineAt: r.callDeadlineAt,
      confirmedAt: r.confirmedAt,
      confirmDeadlineAt: r.confirmDeadlineAt,
      closedAt: r.closedAt,
      closeReason: r.closeReason,
      notice: r.notice,
    })),
    settings,
    hours,
    timeZone: TIME_ZONE,
  };
}

// ---------------------------------------------------------------------------
// Enregistrement
// ---------------------------------------------------------------------------

async function persist(tx: Tx, engine: Laundry, at: Date, extraLogs: LogEntry[]): Promise<boolean> {
  const changes = engine.changes();
  const logs = [...changes.logs, ...extraLogs];

  for (const m of changes.machines) {
    await tx.update(t.machines).set({ status: m.status, updatedAt: at }).where(eq(t.machines.id, m.id));
  }

  // Réservations d'abord (les cycles y font référence).
  if (changes.reservations.length > 0) {
    // Phase 1 : écarter les rangs des lignes modifiées, pour qu'une renumérotation
    // ne heurte jamais l'index unique des rangs en attente pendant la mise à jour.
    const ids = changes.reservations.map((r) => r.id);
    await tx
      .update(t.reservations)
      .set({ rank: sql`-${t.reservations.rank} - 1000000000` })
      .where(inArray(t.reservations.id, ids));
    // Phase 2 : valeurs définitives.
    for (const r of changes.reservations) {
      const values = {
        id: r.id,
        studentId: r.studentId,
        targetMachineId: r.targetMachineId,
        assignedMachineId: r.assignedMachineId,
        rank: r.rank,
        status: r.status,
        createdAt: r.createdAt,
        calledAt: r.calledAt,
        callDeadlineAt: r.callDeadlineAt,
        confirmedAt: r.confirmedAt,
        confirmDeadlineAt: r.confirmDeadlineAt,
        closedAt: r.closedAt,
        closeReason: r.closeReason,
        notice: r.notice,
      };
      const { id: _id, studentId: _s, createdAt: _c, ...updatable } = values;
      await tx
        .insert(t.reservations)
        .values(values)
        .onConflictDoUpdate({ target: t.reservations.id, set: updatable });
    }
  }

  for (const c of changes.cycles) {
    const values = {
      id: c.id,
      machineId: c.machineId,
      studentId: c.studentId,
      reservationId: c.reservationId,
      startedAt: c.startedAt,
      plannedDurationMin: c.plannedDurationMin,
      plannedEndAt: c.plannedEndAt,
      actualEndAt: c.actualEndAt,
      status: c.status,
      endReason: c.endReason,
    };
    await tx
      .insert(t.cycles)
      .values(values)
      .onConflictDoUpdate({
        target: t.cycles.id,
        set: {
          plannedDurationMin: c.plannedDurationMin,
          plannedEndAt: c.plannedEndAt,
          actualEndAt: c.actualEndAt,
          status: c.status,
          endReason: c.endReason,
        },
      });
  }

  if (logs.length > 0) {
    await tx.insert(t.activityLog).values(
      logs.map((l) => ({
        at,
        actorId: l.actorId,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        details: l.details,
      })),
    );
  }

  if (changes.notifications.length > 0) {
    await tx.insert(t.notifications).values(
      changes.notifications.map((n) => ({
        userId: n.userId,
        kind: n.kind,
        details: n.details,
        createdAt: at,
      })),
    );
  }

  const changed = engine.hasChanges() || extraLogs.length > 0;
  await tx
    .update(t.laundryState)
    .set({
      nextDeadlineAt: engine.nextDeadline(),
      ...(changed ? { version: sql`${t.laundryState.version} + 1`, updatedAt: at } : {}),
    })
    .where(eq(t.laundryState.id, 1));
  return changed;
}

// ---------------------------------------------------------------------------
// Transaction métier
// ---------------------------------------------------------------------------

export interface LaundryContext {
  tx: Tx;
  engine: Laundry;
  now: Date;
  /** Nombre d'échéances traitées par settle() au début de la transaction. */
  settled: number;
  /** Ajoute une entrée au journal (actions hors moteur, ex. : comptes, paramètres). */
  log(entry: LogEntry): void;
}

/**
 * Exécute une action métier :
 *   BEGIN → verrou global → chargement de l'état actif → settle() (échéances dépassées)
 *   → action → enregistrement des changements + journal + messages → version + 1 → COMMIT
 *
 * En cas d'erreur (règle métier non respectée), tout est annulé ; les échéances
 * éventuellement dépassées seront traitées par la requête suivante.
 */
export async function withLaundry<T>(
  fn: (ctx: LaundryContext) => Promise<T> | T,
  db: Database = getDb(),
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockLaundry(tx);
    const now = clockNow();
    const engine = new Laundry(await loadSnapshot(tx), { now, newId: randomUUID });
    const settled = engine.settle();
    const extraLogs: LogEntry[] = [];
    const result = await fn({ tx, engine, now, settled, log: (e) => extraLogs.push(e) });
    await persist(tx, engine, now, extraLogs);
    return result;
  });
}

/** Traite les échéances dépassées (sans condition). Renvoie le nombre d'échéances traitées. */
export async function settleDeadlines(db: Database = getDb()): Promise<number> {
  return withLaundry(({ settled }) => settled, db);
}

/**
 * Traite les échéances seulement si la prochaine est atteinte, en le vérifiant à
 * nouveau APRÈS avoir pris le verrou. Quand 100 téléphones rafraîchissent au moment
 * d'une échéance, le premier la traite ; les autres attendent le verrou, constatent
 * que `next_deadline_at` est désormais dans le futur et repartent après une seule
 * lecture, sans rien charger ni écrire.
 */
export async function settleIfDue(db: Database = getDb()): Promise<number> {
  return db.transaction(async (tx) => {
    await lockLaundry(tx);
    const at = clockNow();
    const [state] = await tx
      .select({ nextDeadlineAt: t.laundryState.nextDeadlineAt })
      .from(t.laundryState)
      .where(eq(t.laundryState.id, 1));
    if (!state?.nextDeadlineAt || state.nextDeadlineAt.getTime() > at.getTime()) return 0;
    const engine = new Laundry(await loadSnapshot(tx), { now: at, newId: randomUUID });
    const settled = engine.settle();
    await persist(tx, engine, at, []);
    return settled;
  });
}

/** Incrémente la version (changement hors moteur visible par les clients, ex. : paramètres). */
export async function bumpVersion(tx: Tx, at: Date): Promise<void> {
  await tx
    .update(t.laundryState)
    .set({ version: sql`${t.laundryState.version} + 1`, updatedAt: at })
    .where(eq(t.laundryState.id, 1));
}
