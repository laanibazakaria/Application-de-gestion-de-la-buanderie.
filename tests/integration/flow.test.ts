import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as stop from "@/app/api/admin/cycles/[id]/stop/route";
import * as disable from "@/app/api/admin/machines/[id]/disable/route";
import * as cron from "@/app/api/cron/settle/route";
import * as cycles from "@/app/api/cycles/route";
import * as reservations from "@/app/api/reservations/route";
import * as cancel from "@/app/api/reservations/[id]/cancel/route";
import * as confirm from "@/app/api/reservations/[id]/confirm/route";
import * as switchAny from "@/app/api/reservations/[id]/switch-to-any/route";
import * as testClock from "@/app/api/test/clock/route";

import {
  adminSession,
  advanceMinutes,
  call,
  closeTestPools,
  fillAllMachines,
  resetClock,
  resetDatabase,
  sql,
  studentSession,
} from "./helpers";

const cronAuth = () => ({ headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });

async function reservationRow(id: string) {
  const [row] = await sql<Record<string, unknown>>("select * from reservations where id = $1", [id]);
  return row!;
}

async function machine(n: number) {
  const [row] = await sql<{ status: string }>("select status from machines where id = $1", [n]);
  return row!.status;
}

async function reserve(token: string, targetMachineId: number | null) {
  const res = await call(reservations.POST, { token, body: { targetMachineId } });
  expect(res.status).toBe(201);
  return res.json.reservationId as string;
}

beforeEach(async () => {
  await resetDatabase();
  resetClock();
});
beforeAll(() => resetDatabase());
afterAll(() => closeTestPools());

describe("parcours complet par l'API", () => {
  it("réserver → appelé → « Je suis là » → lancer le cycle → fin automatique → suivant appelé", async () => {
    const a = await studentSession();
    const b = await studentSession();
    const ra = await reserve(a.token, 2);
    const rb = await reserve(b.token, 2);
    expect(await reservationRow(ra)).toMatchObject({ status: "called", assigned_machine_id: 2 });
    expect(await reservationRow(rb)).toMatchObject({ status: "waiting" });
    expect(await machine(2)).toBe("awaiting_student");

    // L'étudiant appelé a reçu un message ; tout est journalisé.
    const notes = await sql("select kind from notifications where user_id = $1", [a.id]);
    expect(notes.map((n) => n.kind)).toEqual(["called"]);
    const actions = (await sql("select action from activity_log order by id")).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["reservation.created", "reservation.called"]));

    expect((await call(confirm.POST, { method: "POST", token: a.token, params: { id: ra } })).status).toBe(
      200,
    );
    const started = await call(cycles.POST, { token: a.token, body: { machineId: 2, durationMin: 30 } });
    expect(started.status).toBe(201);
    expect(await machine(2)).toBe("running");

    // 30 minutes plus tard, la première requête venue traite la fin du cycle.
    advanceMinutes(31);
    const res = await call(cron.GET, cronAuth());
    expect(res.json).toMatchObject({ due: true, settled: 1 });
    const [cycle] = await sql(
      "select status, end_reason, actual_end_at, planned_end_at from cycles where id = $1",
      [started.json.cycleId],
    );
    expect(cycle).toMatchObject({ status: "finished", end_reason: "completed" });
    expect(cycle!.actual_end_at).toEqual(cycle!.planned_end_at);
    expect(await reservationRow(rb)).toMatchObject({ status: "called", assigned_machine_id: 2 });
  });

  it("sans confirmation après 5 minutes : place perdue au profit du suivant", async () => {
    const a = await studentSession();
    const b = await studentSession();
    const ra = await reserve(a.token, 1);
    const rb = await reserve(b.token, 1);

    advanceMinutes(4);
    expect((await call(cron.GET, cronAuth())).json.due).toBe(false);
    advanceMinutes(1);
    expect((await call(cron.GET, cronAuth())).json.settled).toBe(1);

    expect(await reservationRow(ra)).toMatchObject({ status: "expired", close_reason: "no_show" });
    expect(await reservationRow(rb)).toMatchObject({ status: "called" });
    const kinds = (await sql("select kind from notifications where user_id = $1 order by id", [a.id])).map(
      (n) => n.kind,
    );
    expect(kinds).toEqual(["called", "expired_no_show"]);
    // Trop tard pour confirmer
    const late = await call(confirm.POST, { method: "POST", token: a.token, params: { id: ra } });
    expect(late.status).toBe(404);
  });

  it("les échéances sont aussi traitées par n'importe quelle action, sans la tâche planifiée", async () => {
    const a = await studentSession();
    const b = await studentSession();
    const ra = await reserve(a.token, 4);
    advanceMinutes(6);
    // b réserve : la transaction commence par traiter l'expiration de a, puis b est appelé directement.
    const rb = await reserve(b.token, 4);
    expect(await reservationRow(ra)).toMatchObject({ status: "expired" });
    expect(await reservationRow(rb)).toMatchObject({ status: "called", assigned_machine_id: 4 });
  });

  it("annulation par l'appelé : le suivant est appelé immédiatement", async () => {
    const a = await studentSession();
    const b = await studentSession();
    const ra = await reserve(a.token, 5);
    const rb = await reserve(b.token, 5);
    await call(cancel.POST, { method: "POST", token: a.token, params: { id: ra } });
    expect(await reservationRow(rb)).toMatchObject({ status: "called", assigned_machine_id: 5 });
  });

  it("machine mise hors service : étudiants prévenus, bascule en « première disponible »", async () => {
    await fillAllMachines();
    const admin = await adminSession();
    const a = await studentSession();
    const ra = await reserve(a.token, 6);
    // Libère la machine 3 (fin anticipée par l'admin) : a reste sur la 6.
    const [c3] = await sql<{ id: string }>(
      "select id from cycles where machine_id = 3 and status = 'running'",
    );
    await call(stop.POST, { token: admin.token, params: { id: c3!.id }, body: { mode: "ended_early" } });
    expect(await reservationRow(ra)).toMatchObject({ status: "waiting" });

    const [c6] = await sql<{ id: string }>(
      "select id from cycles where machine_id = 6 and status = 'running'",
    );
    await call(stop.POST, { token: admin.token, params: { id: c6!.id }, body: { mode: "cancelled" } });
    // a est appelé sur la 6 puis la machine passe hors service : il retourne en file, prévenu.
    expect(await reservationRow(ra)).toMatchObject({ status: "called", assigned_machine_id: 6 });
    expect(
      (await call(disable.POST, { method: "POST", token: admin.token, params: { id: "6" } })).status,
    ).toBe(200);
    expect(await reservationRow(ra)).toMatchObject({ status: "waiting", notice: "machine_out_of_service" });

    await call(switchAny.POST, { method: "POST", token: a.token, params: { id: ra } });
    expect(await reservationRow(ra)).toMatchObject({
      status: "called",
      assigned_machine_id: 3,
      target_machine_id: null,
    });
  });

  it("un cycle en cours empêche de mettre la machine hors service", async () => {
    await fillAllMachines();
    const admin = await adminSession();
    const res = await call(disable.POST, { method: "POST", token: admin.token, params: { id: "1" } });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("MACHINE_BUSY");
  });

  it("réservation impossible en dehors des horaires", async () => {
    await sql("update opening_hours set is_open = false");
    const a = await studentSession();
    const res = await call(reservations.POST, { token: a.token, body: { targetMachineId: 1 } });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("LAUNDRY_CLOSED");
  });
});

describe("redémarrage du serveur", () => {
  it("aucun cycle ni réservation perdu, échéances justes après reprise", async () => {
    await fillAllMachines();
    const a = await studentSession();
    const ra = await reserve(a.token, 1);
    const [before] = await sql<{ planned_end_at: Date }>(
      "select planned_end_at from cycles where machine_id = 1 and status = 'running'",
    );

    // « Redémarrage » : toutes les connexions et tout l'état en mémoire du serveur sont perdus.
    await closeTestPools();
    advanceMinutes(15); // la machine 1 devait finir à +10 ; personne n'a rien demandé entre-temps

    const res = await call(cron.GET, cronAuth());
    expect(res.json.settled).toBe(1);
    const [cycle] = await sql<{ status: string; actual_end_at: Date }>(
      "select status, actual_end_at from cycles where machine_id = 1 order by started_at desc limit 1",
    );
    expect(cycle).toMatchObject({ status: "finished" });
    expect(cycle!.actual_end_at).toEqual(before!.planned_end_at);
    expect(await reservationRow(ra)).toMatchObject({ status: "called", assigned_machine_id: 1 });
    expect(await sql("select 1 from cycles where status = 'running'")).toHaveLength(6);
  });
});

describe("tâche planifiée /api/cron/settle", () => {
  it("refuse sans le secret", async () => {
    expect((await call(cron.GET)).status).toBe(401);
    expect((await call(cron.GET, { headers: { authorization: "Bearer mauvais" } })).status).toBe(401);
  });

  it("ne fait qu'une lecture quand aucune échéance n'est atteinte", async () => {
    const versionBefore = (await sql("select version from laundry_state"))[0]!.version;
    const res = await call(cron.GET, cronAuth());
    expect(res.json).toEqual({ settled: 0, due: false });
    expect((await sql("select version from laundry_state"))[0]!.version).toBe(versionBefore);
  });
});

describe("route /api/test/clock", () => {
  it("disponible en local pour les tests", async () => {
    const res = await call(testClock.POST, { body: { offsetMs: 60_000 } });
    expect(res.status).toBe(200);
    expect(res.json.offsetMs).toBe(60_000);
  });

  it.each([
    ["VERCEL", "1"],
    ["VERCEL_ENV", "production"],
    ["DATABASE_URL", "postgres://u:p@ep-cool-1234-pooler.eu-central-1.aws.neon.tech/neondb"],
    ["APP_URL", "https://buanderie.vercel.app"],
    ["E2E_TEST_CLOCK", "0"],
  ])("introuvable (404) si %s=%s", async (name, value) => {
    vi.stubEnv(name, value);
    try {
      expect((await call(testClock.GET)).status).toBe(404);
      expect((await call(testClock.POST, { body: { offsetMs: 1 } })).status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
