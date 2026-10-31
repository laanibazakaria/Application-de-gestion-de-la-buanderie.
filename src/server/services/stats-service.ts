/** Statistiques simples pour l'administrateur (sur les N derniers jours). */
import { sql } from "drizzle-orm";

import { TIME_ZONE } from "@/i18n/config";

import { now } from "../clock";
import { getDb } from "../db/client";

import { loadSettings } from "./laundry-tx";

export interface Stats {
  days: number;
  since: string;
  totals: {
    cycles: number;
    hours: number;
    students: number;
    /** Attente moyenne entre la réservation et l'appel (minutes), réservations honorées. */
    avgWaitMin: number | null;
  };
  noShow: { noShows: number; notStarted: number; fulfilled: number; rate: number | null };
  perMachine: Array<{ machineNumber: number; name: string; cycles: number; hours: number }>;
  /** Cycles commencés par heure de la journée (0–23, heure de Casablanca). */
  perHour: number[];
  /** Cycles commencés par jour de la semaine (1 = lundi … 7 = dimanche). */
  perWeekday: number[];
  /** Étudiants ayant atteint le seuil d'absences sur la période paramétrée. */
  warnings: Array<{ id: string; firstName: string; lastName: string; room: string | null; noShows: number }>;
}

export async function getStats(days: number): Promise<Stats> {
  const db = getDb();
  const at = now();
  const since = new Date(at.getTime() - days * 86_400_000);
  const settings = await loadSettings(db);
  const warnSince = new Date(at.getTime() - settings.noShowWindowDays * 86_400_000);

  // Durée réelle d'un cycle : fin réelle (ou maintenant s'il tourne encore) − début.
  const minutes = sql`extract(epoch from (coalesce(c.actual_end_at, least(c.planned_end_at, ${at})) - c.started_at)) / 60`;

  const totals = await db.execute<{ cycles: number; minutes: number | null; students: number }>(sql`
    select count(*)::int as cycles, coalesce(sum(${minutes}), 0)::float as minutes, count(distinct c.student_id)::int as students
    from cycles c where c.started_at >= ${since} and c.status <> 'cancelled'`);

  const wait = await db.execute<{ avg: number | null }>(sql`
    select avg(extract(epoch from (r.called_at - r.created_at)) / 60)::float as avg
    from reservations r where r.close_reason = 'fulfilled' and r.created_at >= ${since} and r.called_at is not null`);

  const outcomes = await db.execute<{ reason: string; n: number }>(sql`
    select close_reason as reason, count(*)::int as n from reservations
    where closed_at >= ${since} and close_reason in ('fulfilled', 'no_show', 'not_started')
    group by close_reason`);

  const perMachine = await db.execute<{ number: number; name: string; cycles: number; minutes: number }>(sql`
    select m.number, m.name, count(c.id)::int as cycles, coalesce(sum(${minutes}), 0)::float as minutes
    from machines m
    left join cycles c on c.machine_id = m.id and c.started_at >= ${since} and c.status <> 'cancelled'
    group by m.number, m.name order by m.number`);

  const perHour = await db.execute<{ h: number; n: number }>(sql`
    select extract(hour from c.started_at at time zone ${TIME_ZONE})::int as h, count(*)::int as n
    from cycles c where c.started_at >= ${since} and c.status <> 'cancelled' group by 1`);

  const perWeekday = await db.execute<{ d: number; n: number }>(sql`
    select extract(isodow from c.started_at at time zone ${TIME_ZONE})::int as d, count(*)::int as n
    from cycles c where c.started_at >= ${since} and c.status <> 'cancelled' group by 1`);

  const warnings = await db.execute<{
    id: string;
    first_name: string;
    last_name: string;
    room: string | null;
    n: number;
  }>(sql`
    select u.id, u.first_name, u.last_name, u.room, count(*)::int as n
    from reservations r join users u on u.id = r.student_id
    where r.close_reason = 'no_show' and r.closed_at > ${warnSince}
    group by u.id having count(*) >= ${settings.noShowWarningThreshold}
    order by n desc, u.last_name`);

  const byReason = new Map(outcomes.rows.map((r) => [r.reason, Number(r.n)]));
  const fulfilled = byReason.get("fulfilled") ?? 0;
  const noShows = byReason.get("no_show") ?? 0;
  const notStarted = byReason.get("not_started") ?? 0;
  const calledTotal = fulfilled + noShows + notStarted;
  const t = totals.rows[0]!;

  const hours = Array.from({ length: 24 }, () => 0);
  for (const r of perHour.rows) hours[Number(r.h)] = Number(r.n);
  const weekdays = Array.from({ length: 7 }, () => 0);
  for (const r of perWeekday.rows) weekdays[Number(r.d) - 1] = Number(r.n);
  const round1 = (x: number) => Math.round(x * 10) / 10;

  return {
    days,
    since: since.toISOString(),
    totals: {
      cycles: Number(t.cycles),
      hours: round1(Number(t.minutes ?? 0) / 60),
      students: Number(t.students),
      avgWaitMin: wait.rows[0]?.avg == null ? null : Math.round(Number(wait.rows[0].avg)),
    },
    noShow: { noShows, notStarted, fulfilled, rate: calledTotal ? noShows / calledTotal : null },
    perMachine: perMachine.rows.map((r) => ({
      machineNumber: Number(r.number),
      name: r.name,
      cycles: Number(r.cycles),
      hours: round1(Number(r.minutes) / 60),
    })),
    perHour: hours,
    perWeekday: weekdays,
    warnings: warnings.rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      room: r.room,
      noShows: Number(r.n),
    })),
  };
}
