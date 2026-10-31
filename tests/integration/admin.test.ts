import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as activity from "@/app/api/admin/activity/route";
import * as extend from "@/app/api/admin/cycles/[id]/extend/route";
import * as machine from "@/app/api/admin/machines/[id]/route";
import * as queue from "@/app/api/admin/queue/route";
import * as move from "@/app/api/admin/queue/[id]/move/route";
import * as settings from "@/app/api/admin/settings/route";
import * as users from "@/app/api/admin/users/route";
import * as importUsers from "@/app/api/admin/users/import/route";
import * as resetPassword from "@/app/api/admin/users/[id]/reset-password/route";
import * as reactivate from "@/app/api/admin/users/[id]/reactivate/route";
import * as suspend from "@/app/api/admin/users/[id]/suspend/route";
import * as login from "@/app/api/auth/login/route";
import * as me from "@/app/api/auth/me/route";
import * as cron from "@/app/api/cron/settle/route";
import * as cycles from "@/app/api/cycles/route";
import * as history from "@/app/api/me/history/route";
import * as reservations from "@/app/api/reservations/route";

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

let admin: Awaited<ReturnType<typeof adminSession>>;

beforeAll(async () => {
  await resetDatabase();
});
beforeEach(async () => {
  resetClock();
  await sql("truncate rate_limits");
  admin = await adminSession();
});
afterAll(() => closeTestPools());

describe("comptes", () => {
  it("création avec mot de passe temporaire, changement obligatoire à la première connexion", async () => {
    const res = await call(users.POST, {
      token: admin.token,
      body: { schoolId: "E2026-100", firstName: "Salma", lastName: "Benali", room: "B12" },
    });
    expect(res.status).toBe(201);
    expect(res.json.temporaryPassword).toMatch(/^[A-Za-z2-9]{10}$/);
    const token = await loginAs({ schoolId: "E2026-100", password: res.json.temporaryPassword });
    expect((await call(me.GET, { token })).json.user).toMatchObject({
      mustChangePassword: true,
      room: "B12",
    });
  });

  it("identifiant déjà utilisé → 409 ; données invalides → 422", async () => {
    const body = { schoolId: "E2026-101", firstName: "A", lastName: "B" };
    expect((await call(users.POST, { token: admin.token, body })).status).toBe(201);
    const dup = await call(users.POST, { token: admin.token, body: { ...body, schoolId: "e2026-101" } });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("SCHOOL_ID_TAKEN");
    expect((await call(users.POST, { token: admin.token, body: { ...body, schoolId: "a b" } })).status).toBe(
      422,
    );
  });

  it("plusieurs administrateurs possibles", async () => {
    const res = await call(users.POST, {
      token: admin.token,
      body: { role: "admin", schoolId: "ADM-2", firstName: "Second", lastName: "Responsable" },
    });
    expect(res.status).toBe(201);
    const list = await call(users.GET, { token: admin.token, query: "role=admin" });
    expect(list.json.users.map((u: { schoolId: string }) => u.schoolId)).toContain("ADM-2");
  });

  it("import CSV (séparateur ;, guillemets, BOM)", async () => {
    const csv =
      '﻿nom;prénom;chambre;identifiant\nAlaoui;Youssef;A01;CSV-1\n"El Idrissi";"Fatima ""Fati""";A02;CSV-2\n';
    const res = await call(importUsers.POST, { token: admin.token, body: { csv } });
    expect(res.status).toBe(201);
    expect(res.json.created).toHaveLength(2);
    expect(res.json.created[1]).toMatchObject({
      lastName: "El Idrissi",
      firstName: 'Fatima "Fati"',
      room: "A02",
    });
    const token = await loginAs({ schoolId: "CSV-1", password: res.json.created[0].temporaryPassword });
    expect(token).toBeTruthy();
  });

  it("import CSV tout ou rien : aucune création si une ligne est invalide", async () => {
    const csv = "nom,prénom,identifiant\nA,B,CSV-OK\n,C,CSV-BAD\nD,E,CSV-1\nF,G,CSV-OK";
    const res = await call(importUsers.POST, { token: admin.token, body: { csv } });
    expect(res.status).toBe(422);
    expect(res.json.created).toEqual([]);
    expect(res.json.errors.map((e: { line: number }) => e.line)).toEqual([3, 4, 5]);
    expect(await sql("select 1 from users where school_id = 'CSV-OK'")).toHaveLength(0);
  });

  it("suspension : déconnexion immédiate, réservation annulée, suivant appelé ; réactivation", async () => {
    const a = await studentSession();
    const b = await studentSession();
    const ra = await call(reservations.POST, { token: a.token, body: { targetMachineId: 7 } });
    const rb = await call(reservations.POST, { token: b.token, body: { targetMachineId: 7 } });
    expect(
      (await call(suspend.POST, { method: "POST", token: admin.token, params: { id: a.id } })).status,
    ).toBe(200);
    expect((await call(me.GET, { token: a.token })).status).toBe(401);
    expect(
      (await sql("select status, close_reason from reservations where id = $1", [ra.json.reservationId]))[0],
    ).toEqual({
      status: "cancelled",
      close_reason: "cancelled_by_admin",
    });
    expect(
      (await sql("select status from reservations where id = $1", [rb.json.reservationId]))[0]!.status,
    ).toBe("called");
    expect((await call(login.POST, { body: { schoolId: a.schoolId, password: a.password } })).status).toBe(
      403,
    );

    await call(reactivate.POST, { method: "POST", token: admin.token, params: { id: a.id } });
    expect((await call(login.POST, { body: { schoolId: a.schoolId, password: a.password } })).status).toBe(
      200,
    );
  });

  it("un administrateur ne peut pas se suspendre lui-même", async () => {
    const res = await call(suspend.POST, { method: "POST", token: admin.token, params: { id: admin.id } });
    expect(res.status).toBe(409);
  });

  it("réinitialisation du mot de passe : ancien mot de passe et sessions invalidés", async () => {
    const a = await studentSession();
    const res = await call(resetPassword.POST, { method: "POST", token: admin.token, params: { id: a.id } });
    expect((await call(me.GET, { token: a.token })).status).toBe(401);
    expect((await call(login.POST, { body: { schoolId: a.schoolId, password: a.password } })).status).toBe(
      401,
    );
    await loginAs({ schoolId: a.schoolId, password: res.json.temporaryPassword });
  });

  it("avertissement après 3 absences sur 30 jours", async () => {
    const s = await createUser();
    for (let i = 0; i < 3; i++) {
      await sql(
        `insert into reservations (id, student_id, rank, status, closed_at, close_reason, created_at)
         values (gen_random_uuid(), $1, $2, 'expired', now() - make_interval(days => $3), 'no_show', now() - make_interval(days => $3))`,
        [s.id, 1000 + i, i === 2 ? 40 : i],
      );
    }
    let list = await call(users.GET, { token: admin.token, query: "role=student" });
    let item = list.json.users.find((u: { id: string }) => u.id === s.id);
    expect(item).toMatchObject({ noShowCount: 2, noShowWarning: false }); // la 3e date de 40 jours
    await sql(
      `insert into reservations (id, student_id, rank, status, closed_at, close_reason) values (gen_random_uuid(), $1, 2000, 'expired', now(), 'no_show')`,
      [s.id],
    );
    list = await call(users.GET, { token: admin.token, query: "role=student" });
    item = list.json.users.find((u: { id: string }) => u.id === s.id);
    expect(item).toMatchObject({ noShowCount: 3, noShowWarning: true });
  });
});

describe("files et cycles", () => {
  beforeEach(async () => {
    await sql("truncate cycles, reservations cascade");
    await sql("update machines set status = 'free'");
    await fillAllMachines();
  });

  it("ajouter un étudiant dans une file et réordonner", async () => {
    const [{ max }] = (await sql<{ max: number }>(
      "select coalesce(max(id), 0)::int as max from activity_log",
    )) as [{ max: number }];
    const s1 = await createUser();
    const s2 = await createUser();
    const r1 = await call(queue.POST, { token: admin.token, body: { studentId: s1.id, targetMachineId: 1 } });
    const r2 = await call(queue.POST, {
      token: admin.token,
      body: { studentId: s2.id, targetMachineId: null },
    });
    expect([r1.status, r2.status]).toEqual([201, 201]);
    await call(move.POST, {
      token: admin.token,
      params: { id: r2.json.reservationId },
      body: { beforeId: r1.json.reservationId },
    });
    const order = await sql("select student_id from reservations where status = 'waiting' order by rank");
    expect(order.map((r) => r.student_id)).toEqual([s2.id, s1.id]);
    const log = await sql(
      "select action, actor_id from activity_log where action like 'queue.%' and id > $1 order by id",
      [max],
    );
    expect(log.map((l) => l.action)).toEqual([
      "queue.added_by_admin",
      "queue.added_by_admin",
      "queue.reordered",
    ]);
    expect(new Set(log.map((l) => l.actor_id))).toEqual(new Set([admin.id]));
  });

  it("refuse d'ajouter un étudiant inexistant ou suspendu", async () => {
    const s = await createUser();
    await sql("update users set status = 'suspended' where id = $1", [s.id]);
    expect(
      (await call(queue.POST, { token: admin.token, body: { studentId: s.id, targetMachineId: 1 } })).status,
    ).toBe(404);
  });

  it("prolonger un cycle repousse l'échéance stockée", async () => {
    const [c] = await sql<{ id: string; planned_end_at: Date }>(
      "select id, planned_end_at from cycles where machine_id = 2",
    );
    await call(extend.POST, { token: admin.token, params: { id: c!.id }, body: { minutes: 15 } });
    const [after] = await sql<{ planned_end_at: Date }>("select planned_end_at from cycles where id = $1", [
      c!.id,
    ]);
    expect(after!.planned_end_at.getTime() - c!.planned_end_at.getTime()).toBe(15 * 60_000);
  });

  it("lancement direct par l'admin sur une machine libre", async () => {
    const [c] = await sql<{ id: string }>("select id from cycles where machine_id = 4");
    const { POST } = await import("@/app/api/admin/cycles/[id]/stop/route");
    await call(POST, { token: admin.token, params: { id: c!.id }, body: { mode: "ended_early" } });
    const s = await createUser();
    const res = await call(cycles.POST, {
      token: admin.token,
      body: { machineId: 4, durationMin: 50, studentId: s.id },
    });
    expect(res.status).toBe(201);
  });

  it("renommer une machine et changer sa durée par défaut", async () => {
    const res = await call(machine.PATCH, {
      method: "PATCH",
      token: admin.token,
      params: { id: "3" },
      body: { name: "Machine 3 (grande)", defaultDurationMin: 60 },
    });
    expect(res.status).toBe(200);
    expect((await sql("select name, default_duration_min from machines where id = 3"))[0]).toEqual({
      name: "Machine 3 (grande)",
      default_duration_min: 60,
    });
  });
});

describe("paramètres", () => {
  it("lecture et modification ; valeurs invalides refusées", async () => {
    const current = await call(settings.GET, { token: admin.token });
    expect(current.json.settings.callDelayMin).toBe(5);
    expect(current.json.hours).toHaveLength(7);

    const bad = await call(settings.PUT, {
      method: "PUT",
      token: admin.token,
      body: { settings: { ...current.json.settings, callDelayMin: 0 } },
    });
    expect(bad.status).toBe(422);
    const badHours = await call(settings.PUT, {
      method: "PUT",
      token: admin.token,
      body: { hours: current.json.hours.map((h: object) => ({ ...h, openMinute: 900, closeMinute: 600 })) },
    });
    expect(badHours.status).toBe(422);

    const ok = await call(settings.PUT, {
      method: "PUT",
      token: admin.token,
      body: { settings: { ...current.json.settings, callDelayMin: 7, cycleDurationsMin: [40, 20] } },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.settings).toMatchObject({ callDelayMin: 7, cycleDurationsMin: [20, 40] });
  });

  it("le nouveau délai de présentation s'applique aux appels suivants", async () => {
    await sql("truncate cycles, reservations cascade");
    await sql("update machines set status = 'free'");
    const s = await studentSession();
    const r = await call(reservations.POST, { token: s.token, body: { targetMachineId: 1 } });
    const [row] = await sql<{ called_at: Date; call_deadline_at: Date }>(
      "select called_at, call_deadline_at from reservations where id = $1",
      [r.json.reservationId],
    );
    expect(row!.call_deadline_at.getTime() - row!.called_at.getTime()).toBe(7 * 60_000);
  });

  afterEach(() => sql("update opening_hours set is_open = true, open_minute = 0, close_minute = 1440"));

  it("fermer la buanderie annule les files à l'échéance suivante", async () => {
    await sql("truncate cycles, reservations cascade");
    await sql("update machines set status = 'free'");
    await fillAllMachines();
    const s = await studentSession();
    const r = await call(reservations.POST, { token: s.token, body: { targetMachineId: 1 } });
    const current = await call(settings.GET, { token: admin.token });
    // La journée se termine dans le passé : la fermeture est déjà passée.
    await call(settings.PUT, {
      method: "PUT",
      token: admin.token,
      body: {
        hours: current.json.hours.map((h: object) => ({ ...h, isOpen: true, openMinute: 0, closeMinute: 1 })),
      },
    });
    advanceMinutes(1);
    await call(cron.GET, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const [row] = await sql("select status, close_reason from reservations where id = $1", [
      r.json.reservationId,
    ]);
    expect(row).toMatchObject({ status: "cancelled", close_reason: "laundry_closed" });
  });
});

describe("historique et journal", () => {
  it("l'étudiant voit son historique ; l'admin voit le journal paginé", async () => {
    const s = await studentSession();
    await call(reservations.POST, { token: s.token, body: { targetMachineId: null } });
    const h = await call(history.GET, { token: s.token });
    expect(h.status).toBe(200);
    expect(h.json.reservations.length).toBeGreaterThan(0);

    const page = await call(activity.GET, { token: admin.token, query: "limit=2" });
    expect(page.json.entries).toHaveLength(2);
    expect(page.json.nextBeforeId).toBeTypeOf("number");
    const next = await call(activity.GET, {
      token: admin.token,
      query: `limit=2&beforeId=${page.json.nextBeforeId}`,
    });
    expect(next.json.entries[0].id).toBeLessThan(page.json.nextBeforeId);
    const filtered = await call(activity.GET, { token: admin.token, query: "action=auth." });
    expect(filtered.json.entries.every((e: { action: string }) => e.action.startsWith("auth."))).toBe(true);
  });
});
