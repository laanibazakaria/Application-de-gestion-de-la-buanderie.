import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetDatabase, testDb } from "./helpers";

let pool: Pool;

beforeAll(async () => {
  await resetDatabase(process.env.DATABASE_URL!);
  pool = testDb().pool;
});
afterAll(() => pool.end());

beforeEach(async () => {
  await pool.query("truncate cycles, reservations, sessions, notifications, activity_log, users cascade");
});

async function createStudent(schoolId = `E${Math.random().toString(36).slice(2, 8)}`): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into users (role, school_id, first_name, last_name, room, password_hash)
     values ('student', $1, 'Test', 'Étudiant', '101', 'x') returning id`,
    [schoolId],
  );
  return rows[0]!.id;
}

async function insertReservation(over: Record<string, unknown>) {
  const r: Record<string, unknown> = {
    id: randomUUID(),
    status: "waiting",
    rank: 1,
    assigned_machine_id: null,
    call_deadline_at: null,
    confirm_deadline_at: null,
    ...over,
  };
  await pool.query(
    `insert into reservations (id, student_id, status, rank, assigned_machine_id, call_deadline_at, confirm_deadline_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [r.id, r.student_id, r.status, r.rank, r.assigned_machine_id, r.call_deadline_at, r.confirm_deadline_at],
  );
  return r.id;
}

async function insertCycle(machineId: number, studentId: string, status = "running") {
  await pool.query(
    `insert into cycles (id, machine_id, student_id, started_at, planned_duration_min, planned_end_at, status, actual_end_at, end_reason)
     values ($1, $2, $3, now(), 45, now() + interval '45 minutes', $4::cycle_status,
             case when $4::cycle_status = 'running' then null else now() end,
             case when $4::cycle_status = 'running' then null else 'completed'::cycle_end_reason end)`,
    [randomUUID(), machineId, studentId, status],
  );
}

describe("migrations et données de référence", () => {
  it("crée les 7 machines, les paramètres par défaut, les horaires et l'état de synchronisation", async () => {
    const machines = await pool.query("select number, status from machines order by number");
    expect(machines.rows.map((m) => m.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(machines.rows.map((m) => m.status))).toEqual(new Set(["free"]));

    const { rows } = await pool.query("select * from settings");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      call_delay_min: 5,
      confirm_delay_min: 3,
      cycle_durations_min: [30, 45, 60, 90],
      max_active_reservations: 1,
      student_can_start_cycle: true,
      no_show_warning_threshold: 3,
      no_show_window_days: 30,
    });
    expect((await pool.query("select count(*)::int as n from opening_hours")).rows[0].n).toBe(7);
    expect((await pool.query("select version from laundry_state")).rows[0].version).toBe("1");
  });

  it("les migrations sont idempotentes", async () => {
    await resetDatabase(process.env.DATABASE_URL!);
    const { runMigrations } = await import("@/server/db/migrate");
    await runMigrations(process.env.DATABASE_URL!);
    expect((await pool.query("select count(*)::int as n from machines")).rows[0].n).toBe(7);
  });
});

describe("contraintes de la base", () => {
  it("un seul cycle en cours par machine", async () => {
    const [a, b] = [await createStudent(), await createStudent()];
    await insertCycle(1, a);
    await expect(insertCycle(1, b)).rejects.toThrow(/cycles_one_running_per_machine_uq/);
    await insertCycle(1, b, "finished"); // l'historique n'est pas concerné
  });

  it("un seul cycle en cours par étudiant", async () => {
    const a = await createStudent();
    await insertCycle(1, a);
    await expect(insertCycle(2, a)).rejects.toThrow(/cycles_one_running_per_student_uq/);
  });

  it("un seul étudiant appelé ou présent par machine", async () => {
    const [a, b] = [await createStudent(), await createStudent()];
    const deadline = new Date(Date.now() + 300_000);
    await insertReservation({
      student_id: a,
      status: "called",
      rank: 1,
      assigned_machine_id: 2,
      call_deadline_at: deadline,
    });
    await expect(
      insertReservation({
        student_id: b,
        status: "confirmed",
        rank: 2,
        assigned_machine_id: 2,
        call_deadline_at: deadline,
        confirm_deadline_at: deadline,
      }),
    ).rejects.toThrow(/reservations_one_called_per_machine_uq/);
  });

  it("rang unique parmi les réservations en attente", async () => {
    const [a, b] = [await createStudent(), await createStudent()];
    await insertReservation({ student_id: a, rank: 7 });
    await expect(insertReservation({ student_id: b, rank: 7 })).rejects.toThrow(
      /reservations_waiting_rank_uq/,
    );
  });

  it("une réservation appelée doit avoir une machine et une échéance", async () => {
    const a = await createStudent();
    await expect(insertReservation({ student_id: a, status: "called" })).rejects.toThrow(
      /reservations_called_has_machine_ck/,
    );
  });

  it("refuse un numéro de machine hors de 1 à 7 et un horaire incohérent", async () => {
    await expect(
      pool.query("insert into machines (id, number, name) values (8, 8, 'Machine 8')"),
    ).rejects.toThrow(/machines_number_ck/);
    await expect(
      pool.query("update opening_hours set open_minute = 1000, close_minute = 900 where weekday = 1"),
    ).rejects.toThrow(/opening_hours_range_ck/);
  });

  it("identifiant de l'école unique, sans tenir compte de la casse", async () => {
    await createStudent("E2024-001");
    await expect(createStudent("e2024-001")).rejects.toThrow(/users_school_id_uq/);
  });

  it("une seule ligne de paramètres", async () => {
    await expect(pool.query("insert into settings (id) values (2)")).rejects.toThrow(/settings_singleton_ck/);
  });
});
