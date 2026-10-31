import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as stats from "@/app/api/admin/stats/route";

import {
  adminSession,
  call,
  closeTestPools,
  createUser,
  resetClock,
  resetDatabase,
  sql,
  studentSession,
} from "./helpers";

beforeAll(async () => {
  await resetDatabase();
  resetClock();
});
afterAll(() => closeTestPools());

describe("statistiques", () => {
  it("réservées à l'administrateur", async () => {
    const s = await studentSession();
    expect((await call(stats.GET, { token: s.token })).status).toBe(403);
  });

  it("utilisation par machine, heures de pointe (heure de Casablanca), non-présentation, attente moyenne", async () => {
    const a = await createUser();
    const b = await createUser();
    // Deux cycles de 60 min sur la machine 2, un de 30 min sur la machine 5, commencés à 19:xx heure de Casablanca (UTC+1 en janvier).
    const cycles: Array<[number, string, string, number]> = [
      [2, a.id, "2026-10-20T18:10:00Z", 60],
      [2, b.id, "2026-10-21T18:20:00Z", 60],
      [5, a.id, "2026-10-22T06:00:00Z", 30],
    ];
    for (const [m, s, start, d] of cycles) {
      await sql(
        `insert into cycles (id, machine_id, student_id, started_at, planned_duration_min, planned_end_at, actual_end_at, status, end_reason)
         values (gen_random_uuid(), $1, $2, $3, $4::int, $3::timestamptz + make_interval(mins => $4::int), $3::timestamptz + make_interval(mins => $4::int), 'finished', 'completed')`,
        [m, s, start, d],
      );
    }
    // Un cycle annulé ne compte pas.
    await sql(
      `insert into cycles (id, machine_id, student_id, started_at, planned_duration_min, planned_end_at, actual_end_at, status, end_reason)
       values (gen_random_uuid(), 3, $1, '2026-10-22T10:00:00Z', 45, '2026-10-22T10:45:00Z', '2026-10-22T10:05:00Z', 'cancelled', 'cancelled')`,
      [b.id],
    );
    // 3 honorées (attente 10, 20, 30 min), 1 absence.
    for (const [w, reason] of [
      [10, "fulfilled"],
      [20, "fulfilled"],
      [30, "fulfilled"],
      [0, "no_show"],
    ] as const) {
      await sql(
        `insert into reservations (id, student_id, rank, status, created_at, called_at, closed_at, close_reason, assigned_machine_id, call_deadline_at)
         values (gen_random_uuid(), $1, random(), $2::reservation_status, now() - interval '2 days', now() - interval '2 days' + make_interval(mins => $3::int), now() - interval '1 day', $4::reservation_close_reason, 1, now())`,
        [a.id, reason === "no_show" ? "expired" : "fulfilled", w, reason],
      );
    }

    const admin = await adminSession();
    const res = await call(stats.GET, { token: admin.token, query: "days=30" });
    expect(res.status).toBe(200);
    const st = res.json;
    expect(st.totals).toMatchObject({ cycles: 3, hours: 2.5, students: 2, avgWaitMin: 20 });
    expect(st.perMachine[1]).toMatchObject({ machineNumber: 2, cycles: 2, hours: 2 });
    expect(st.perMachine[4]).toMatchObject({ machineNumber: 5, cycles: 1, hours: 0.5 });
    // Les dates de test sont en octobre 2026 : Casablanca est alors en UTC+0 (données IANA 2026e).
    const offset = (
      await sql<{ h: number }>(
        `select extract(hour from timestamptz '2026-10-20T18:10:00Z' at time zone 'Africa/Casablanca')::int as h`,
      )
    )[0]!.h;
    expect(st.perHour[offset]).toBe(2);
    expect(st.perHour.reduce((x: number, y: number) => x + y, 0)).toBe(3);
    expect(st.noShow).toMatchObject({ fulfilled: 3, noShows: 1, rate: 0.25 });
    expect(st.perWeekday).toHaveLength(7);
  });

  it("liste les étudiants ayant atteint le seuil d'absences", async () => {
    const s = await createUser();
    for (let i = 0; i < 3; i++) {
      await sql(
        `insert into reservations (id, student_id, rank, status, closed_at, close_reason) values (gen_random_uuid(), $1, random(), 'expired', now(), 'no_show')`,
        [s.id],
      );
    }
    const admin = await adminSession();
    const res = await call(stats.GET, { token: admin.token });
    expect(res.json.warnings.map((w: { id: string }) => w.id)).toContain(s.id);
  });
});
