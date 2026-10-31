import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as activity from "@/app/api/admin/activity/route";
import * as stats from "@/app/api/admin/stats/route";
import * as extend from "@/app/api/admin/cycles/[id]/extend/route";
import * as stop from "@/app/api/admin/cycles/[id]/stop/route";
import * as machine from "@/app/api/admin/machines/[id]/route";
import * as disable from "@/app/api/admin/machines/[id]/disable/route";
import * as enable from "@/app/api/admin/machines/[id]/enable/route";
import * as queue from "@/app/api/admin/queue/route";
import * as move from "@/app/api/admin/queue/[id]/move/route";
import * as settings from "@/app/api/admin/settings/route";
import * as users from "@/app/api/admin/users/route";
import * as user from "@/app/api/admin/users/[id]/route";
import * as importUsers from "@/app/api/admin/users/import/route";
import * as reactivate from "@/app/api/admin/users/[id]/reactivate/route";
import * as resetPassword from "@/app/api/admin/users/[id]/reset-password/route";
import * as suspend from "@/app/api/admin/users/[id]/suspend/route";
import * as cycles from "@/app/api/cycles/route";
import * as history from "@/app/api/me/history/route";
import * as read from "@/app/api/notifications/read/route";
import * as reservations from "@/app/api/reservations/route";
import * as cancel from "@/app/api/reservations/[id]/cancel/route";
import * as confirm from "@/app/api/reservations/[id]/confirm/route";
import * as switchAny from "@/app/api/reservations/[id]/switch-to-any/route";

import {
  adminSession,
  call,
  closeTestPools,
  resetClock,
  resetDatabase,
  sql,
  studentSession,
  type CallOptions,
} from "./helpers";

type Handler = Parameters<typeof call>[0];
const id = randomUUID();

/** Toutes les routes réservées à l'administrateur. */
const ADMIN_ROUTES: Array<[string, Handler, CallOptions]> = [
  ["GET /admin/activity", activity.GET, {}],
  ["GET /admin/stats", stats.GET, {}],
  ["POST /admin/cycles/:id/extend", extend.POST, { params: { id }, body: { minutes: 5 } }],
  ["POST /admin/cycles/:id/stop", stop.POST, { params: { id }, body: { mode: "cancelled" } }],
  [
    "PATCH /admin/machines/:id",
    machine.PATCH,
    { method: "PATCH", params: { id: "1" }, body: { name: "M1" } },
  ],
  ["POST /admin/machines/:id/disable", disable.POST, { method: "POST", params: { id: "7" } }],
  ["POST /admin/machines/:id/enable", enable.POST, { method: "POST", params: { id: "7" } }],
  ["POST /admin/queue", queue.POST, { body: { studentId: id, targetMachineId: null } }],
  ["POST /admin/queue/:id/move", move.POST, { params: { id }, body: { beforeId: null } }],
  ["GET /admin/settings", settings.GET, {}],
  ["PUT /admin/settings", settings.PUT, { method: "PUT", body: {} }],
  ["GET /admin/users", users.GET, {}],
  ["POST /admin/users", users.POST, { body: { schoolId: "X1", firstName: "a", lastName: "b" } }],
  ["PATCH /admin/users/:id", user.PATCH, { method: "PATCH", params: { id }, body: { room: "1" } }],
  ["POST /admin/users/import", importUsers.POST, { body: { csv: "nom;prénom;identifiant" } }],
  ["POST /admin/users/:id/suspend", suspend.POST, { method: "POST", params: { id } }],
  ["POST /admin/users/:id/reactivate", reactivate.POST, { method: "POST", params: { id } }],
  ["POST /admin/users/:id/reset-password", resetPassword.POST, { method: "POST", params: { id } }],
];

/** Routes ouvertes à tout utilisateur connecté (droits fins vérifiés par le moteur). */
const USER_ROUTES: Array<[string, Handler, CallOptions]> = [
  ["POST /cycles", cycles.POST, { body: { machineId: 1, durationMin: 45 } }],
  ["GET /me/history", history.GET, {}],
  ["POST /notifications/read", read.POST, { body: { upToId: 1 } }],
  ["POST /reservations/:id/cancel", cancel.POST, { method: "POST", params: { id } }],
  ["POST /reservations/:id/confirm", confirm.POST, { method: "POST", params: { id } }],
  ["POST /reservations/:id/switch-to-any", switchAny.POST, { method: "POST", params: { id } }],
];

let student: Awaited<ReturnType<typeof studentSession>>;
let admin: Awaited<ReturnType<typeof adminSession>>;

beforeAll(async () => {
  await resetDatabase();
  student = await studentSession();
  admin = await adminSession();
});
afterAll(() => closeTestPools());
beforeEach(async () => {
  resetClock();
  await sql("truncate rate_limits");
});

describe("contrôle d'accès par rôle, vérifié côté serveur sur chaque route", () => {
  describe.each(ADMIN_ROUTES)("%s", (_name, handler, opts) => {
    it("anonyme → 401", async () => {
      expect((await call(handler, opts)).status).toBe(401);
    });
    it("étudiant → 403", async () => {
      const res = await call(handler, { ...opts, token: student.token });
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe("FORBIDDEN");
    });
    it("administrateur → autorisé", async () => {
      const res = await call(handler, { ...opts, token: admin.token });
      expect([401, 403]).not.toContain(res.status);
    });
  });

  describe.each(USER_ROUTES)("%s", (_name, handler, opts) => {
    it("anonyme → 401", async () => {
      expect((await call(handler, opts)).status).toBe(401);
    });
    it("étudiant → autorisé (droits fins vérifiés ensuite)", async () => {
      expect((await call(handler, { ...opts, token: student.token })).status).not.toBe(401);
    });
  });

  it("POST /reservations : réservé aux étudiants (l'admin passe par /admin/queue)", async () => {
    expect((await call(reservations.POST, { body: { targetMachineId: 1 } })).status).toBe(401);
    expect((await call(reservations.POST, { token: admin.token, body: { targetMachineId: 1 } })).status).toBe(
      403,
    );
  });

  it("un étudiant ne peut pas agir sur la réservation d'un autre", async () => {
    const other = await studentSession();
    const created = await call(reservations.POST, { token: other.token, body: { targetMachineId: 3 } });
    expect(created.status).toBe(201);
    const params = { id: created.json.reservationId };
    for (const handler of [cancel.POST, confirm.POST, switchAny.POST]) {
      const res = await call(handler, { method: "POST", token: student.token, params });
      expect(res.status).toBe(403);
    }
  });

  it("un étudiant ne peut pas lancer un cycle pour un autre étudiant", async () => {
    const res = await call(cycles.POST, {
      token: student.token,
      body: { machineId: 5, durationMin: 45, studentId: randomUUID() },
    });
    expect(res.status).toBe(403);
  });

  it("paramètres d'URL validés", async () => {
    expect(
      (await call(cancel.POST, { method: "POST", token: student.token, params: { id: "pas-un-uuid" } }))
        .status,
    ).toBe(422);
    expect(
      (await call(disable.POST, { method: "POST", token: admin.token, params: { id: "8" } })).status,
    ).toBe(422);
  });
});
