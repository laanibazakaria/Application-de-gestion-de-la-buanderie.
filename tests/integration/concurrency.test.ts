import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as reservations from "@/app/api/reservations/route";

import { call, closeTestPools, resetClock, resetDatabase, sql, studentSession } from "./helpers";

beforeAll(async () => {
  await resetDatabase();
  resetClock();
});
afterAll(() => closeTestPools());

describe("concurrence", () => {
  it("20 étudiants réservent la même machine au même instant : un seul appelé, ordre unique", async () => {
    const students = await Promise.all(Array.from({ length: 20 }, () => studentSession()));
    const results = await Promise.all(
      students.map((s) => call(reservations.POST, { token: s.token, body: { targetMachineId: 3 } })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));

    const rows = await sql<{ status: string; rank: number; created_at: Date }>(
      "select status, rank, created_at from reservations where target_machine_id = 3 order by rank",
    );
    expect(rows).toHaveLength(20);
    expect(rows.filter((r) => r.status === "called")).toHaveLength(1);
    expect(rows[0]!.status).toBe("called");
    // Rangs uniques et consécutifs, cohérents avec l'ordre d'enregistrement.
    expect(rows.map((r) => r.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const times = rows.map((r) => r.created_at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect((await sql("select status from machines where id = 3"))[0]!.status).toBe("awaiting_student");
  });

  it("un même étudiant envoie 10 réservations simultanées : une seule est acceptée", async () => {
    const s = await studentSession();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        call(reservations.POST, { token: s.token, body: { targetMachineId: (i % 7) + 1 } }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const refused = results.filter((r) => r.status !== 201);
    expect(refused).toHaveLength(9);
    for (const r of refused) expect(r.json.error.code).toBe("MAX_ACTIVE_RESERVATIONS");
    expect(await sql("select 1 from reservations where student_id = $1", [s.id])).toHaveLength(1);
  });

  it("toutes les machines libres et 7 « première disponible » simultanées : une machine chacun", async () => {
    await resetDatabase();
    const students = await Promise.all(Array.from({ length: 7 }, () => studentSession()));
    await Promise.all(
      students.map((s) => call(reservations.POST, { token: s.token, body: { targetMachineId: null } })),
    );
    const rows = await sql<{ assigned_machine_id: number }>(
      "select assigned_machine_id from reservations where status = 'called' order by assigned_machine_id",
    );
    expect(rows.map((r) => r.assigned_machine_id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
