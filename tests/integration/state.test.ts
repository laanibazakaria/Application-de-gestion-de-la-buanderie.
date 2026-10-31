import pg from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as cron from "@/app/api/cron/settle/route";
import * as reservations from "@/app/api/reservations/route";
import * as state from "@/app/api/state/route";
import type { LaundryStateView } from "@/lib/state-types";

import {
  adminSession,
  advanceMinutes,
  call,
  closeTestPools,
  createUser,
  fillAllMachines,
  loginAs,
  resetClock,
  resetDatabase,
  sql,
  studentSession,
} from "./helpers";

beforeEach(async () => {
  await resetDatabase();
  resetClock();
});
afterAll(() => closeTestPools());

async function getState(token: string, etag?: string) {
  const res = await call(state.GET, { token, headers: etag ? { "if-none-match": etag } : {} });
  return { ...res, state: res.json as LaundryStateView };
}

/** Compte les requêtes SQL réellement envoyées à PostgreSQL pendant `fn`. */
async function countQueries(fn: () => Promise<unknown>): Promise<string[]> {
  const spy = vi.spyOn(pg.Client.prototype, "query");
  try {
    await fn();
    return spy.mock.calls.map((c) => {
      const q = c[0] as string | { text?: string };
      return typeof q === "string" ? q : (q.text ?? "");
    });
  } finally {
    spy.mockRestore();
  }
}

describe("GET /api/state", () => {
  it("401 sans session ; 403 tant que le mot de passe temporaire n'est pas changé", async () => {
    expect((await call(state.GET)).status).toBe(401);
    expect((await call(state.GET, { token: "inconnu" })).status).toBe(401);
    const u = await createUser({ mustChangePassword: true });
    const res = await call(state.GET, { token: await loginAs(u) });
    expect(res.status).toBe(403);
  });

  it("renvoie les 7 machines, le résumé, les paramètres et l'heure du serveur", async () => {
    const s = await studentSession();
    const { status, state: st, headers } = await getState(s.token);
    expect(status).toBe(200);
    expect(st.machines.map((m) => m.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(st.summary).toMatchObject({ freeCount: 7, shortestWaitMin: 0 });
    expect(st.settings.cycleDurationsMin).toEqual([30, 45, 60, 90]);
    expect(st.laundry.open).toBe(true);
    expect(headers.get("etag")).toBe(`"v${st.version}"`);
    expect(headers.get("x-server-now")).toBe(st.serverNow);
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("304 sans corps quand rien n'a changé, en UNE seule requête SQL", async () => {
    const s = await studentSession();
    const first = await getState(s.token);
    let res!: Awaited<ReturnType<typeof getState>>;
    const queries = await countQueries(async () => {
      res = await getState(s.token, first.headers.get("etag")!);
    });
    expect(res.status).toBe(304);
    expect(res.json).toBeNull();
    expect(res.headers.get("x-server-now")).toBeTruthy();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/from "laundry_state"/);
  });

  it("toute modification change la version : 200 avec le nouvel état", async () => {
    const a = await studentSession();
    const b = await studentSession();
    const first = await getState(b.token);
    await call(reservations.POST, { token: a.token, body: { targetMachineId: 2 } });
    const after = await getState(b.token, first.headers.get("etag")!);
    expect(after.status).toBe(200);
    expect(after.state.version).toBeGreaterThan(first.state.version);
    expect(after.state.machines[1]!.status).toBe("awaiting_student");
  });

  it("étudiant : file anonyme, sa propre place visible ; « Ma réservation » complète", async () => {
    await fillAllMachines();
    const others = [await studentSession(), await studentSession()];
    for (const o of others) await call(reservations.POST, { token: o.token, body: { targetMachineId: 1 } });
    const me = await studentSession();
    await call(reservations.POST, { token: me.token, body: { targetMachineId: 1 } });

    const { state: st } = await getState(me.token);
    const m1 = st.machines[0]!;
    expect(m1.status).toBe("running");
    expect(m1.cycle?.student).toBeNull(); // identité des autres masquée
    expect(m1.queue.map((q) => [q.position, q.isMine])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(m1.queue.every((q) => (q.isMine ? q.student?.id === me.id : q.student === null))).toBe(true);

    // Fin du cycle à +10 min, puis 45 min par personne devant.
    const end = new Date(m1.cycle!.plannedEndAt).getTime();
    expect(new Date(m1.queue[2]!.estimatedAt!).getTime()).toBe(end + 2 * 45 * 60_000);

    const [mine] = st.me.reservations;
    expect(mine).toMatchObject({ status: "waiting", targetMachineNumber: 1, position: 3 });
    expect(mine!.estimatedAt).toBe(m1.queue[2]!.estimatedAt);
  });

  it("administrateur : identités, chambres et avertissement d'absences visibles", async () => {
    await fillAllMachines();
    const s = await studentSession();
    for (let i = 0; i < 3; i++) {
      await sql(
        `insert into reservations (id, student_id, rank, status, closed_at, close_reason) values (gen_random_uuid(), $1, $2, 'expired', now(), 'no_show')`,
        [s.id, 5000 + i],
      );
    }
    await call(reservations.POST, { token: s.token, body: { targetMachineId: 3 } });
    const admin = await adminSession();
    const { state: st } = await getState(admin.token);
    expect(st.machines[0]!.cycle?.student).toMatchObject({ firstName: "Prénom" });
    expect(st.machines[2]!.queue[0]!.student).toMatchObject({
      id: s.id,
      noShowCount: 3,
      noShowWarning: true,
    });
  });

  it("étudiant appelé : échéance de présentation dans l'état ; attente la plus courte calculée", async () => {
    const s = await studentSession();
    await call(reservations.POST, { token: s.token, body: { targetMachineId: null } });
    const { state: st } = await getState(s.token);
    const [mine] = st.me.reservations;
    expect(mine).toMatchObject({ status: "called", assignedMachineNumber: 1 });
    expect(new Date(mine!.deadlineAt!).getTime() - new Date(mine!.calledAt!).getTime()).toBe(5 * 60_000);
    expect(st.machines[0]!.call).toMatchObject({ status: "called", isMine: true });
    expect(st.summary.freeCount).toBe(6);
    expect(st.me.notifications.map((n) => n.kind)).toEqual(["called"]);
  });
});

describe("échéances traitées au rafraîchissement", () => {
  it("une échéance atteinte est traitée par le premier rafraîchissement, même avec l'ancienne version", async () => {
    const a = await studentSession();
    const b = await studentSession();
    await call(reservations.POST, { token: a.token, body: { targetMachineId: 6 } });
    await call(reservations.POST, { token: b.token, body: { targetMachineId: 6 } });
    const before = await getState(b.token);
    advanceMinutes(5);
    const after = await getState(b.token, before.headers.get("etag")!);
    expect(after.status).toBe(200);
    expect(after.state.me.reservations[0]).toMatchObject({ status: "called", assignedMachineNumber: 6 });
  });

  it("50 rafraîchissements simultanés au moment de l'échéance : traitée une seule fois", async () => {
    const a = await studentSession();
    const b = await studentSession();
    await call(reservations.POST, { token: a.token, body: { targetMachineId: 6 } });
    await call(reservations.POST, { token: b.token, body: { targetMachineId: 6 } });
    advanceMinutes(5);
    const results = await Promise.all(Array.from({ length: 50 }, () => getState(b.token)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await sql("select 1 from activity_log where action = 'reservation.expired.no_show'")).toHaveLength(
      1,
    );
    expect(await sql("select 1 from reservations where status = 'called'")).toHaveLength(1);
    expect(new Set(results.map((r) => r.state.version)).size).toBe(1);
  });

  it("la tâche planifiée et un rafraîchissement simultanés ne traitent l'échéance qu'une fois", async () => {
    const a = await studentSession();
    await call(reservations.POST, { token: a.token, body: { targetMachineId: 2 } });
    advanceMinutes(5);
    const auth = { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } };
    const [c1, , c2] = await Promise.all([call(cron.GET, auth), getState(a.token), call(cron.GET, auth)]);
    expect(Number(c1.json.settled) + Number(c2.json.settled)).toBeLessThanOrEqual(1);
    expect(await sql("select 1 from activity_log where action = 'reservation.expired.no_show'")).toHaveLength(
      1,
    );
  });
});

describe("machine hors service dans l'état", () => {
  it("n'affiche que les réservations qui la visaient, pas les « première disponible »", async () => {
    await fillAllMachines();
    const admin = await adminSession();
    const b = await studentSession();
    const a = await studentSession();
    await call(reservations.POST, { token: b.token, body: { targetMachineId: 7 } });
    await call(reservations.POST, { token: a.token, body: { targetMachineId: null } });
    const [c] = await sql<{ id: string }>("select id from cycles where machine_id = 7");
    const stop = await import("@/app/api/admin/cycles/[id]/stop/route");
    const disable = await import("@/app/api/admin/machines/[id]/disable/route");
    await call(stop.POST, { token: admin.token, params: { id: c!.id }, body: { mode: "cancelled" } }); // b appelé sur la 7
    await call(disable.POST, { method: "POST", token: admin.token, params: { id: "7" } }); // b revient en file
    const { state: st } = await getState(admin.token);
    const m7 = st.machines[6]!;
    expect(m7.status).toBe("out_of_service");
    expect(m7.queue.map((q) => [q.student?.id, q.isAny, q.notice])).toEqual([
      [b.id, false, "machine_out_of_service"],
    ]);
    expect(st.machines[0]!.queue.some((q) => q.student?.id === a.id && q.isAny)).toBe(true);
  });
});
