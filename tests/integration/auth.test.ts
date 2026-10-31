import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as login from "@/app/api/auth/login/route";
import * as logout from "@/app/api/auth/logout/route";
import * as me from "@/app/api/auth/me/route";
import * as password from "@/app/api/auth/password/route";
import * as reservations from "@/app/api/reservations/route";

import { call, closeTestPools, createUser, loginAs, resetClock, resetDatabase, sql } from "./helpers";

beforeAll(() => resetDatabase());
afterAll(() => closeTestPools());
beforeEach(async () => {
  resetClock();
  await sql("truncate rate_limits");
});

describe("connexion", () => {
  it("pose un cookie de session HttpOnly, Secure, SameSite=Lax", async () => {
    const u = await createUser();
    const res = await call(login.POST, { body: { schoolId: u.schoolId, password: u.password } });
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({ id: u.id, role: "student" });
    expect(res.json.user.passwordHash).toBeUndefined();
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
  });

  it("identifiant insensible à la casse", async () => {
    const u = await createUser();
    expect(
      (await call(login.POST, { body: { schoolId: u.schoolId.toLowerCase(), password: u.password } })).status,
    ).toBe(200);
  });

  it("le jeton n'est pas stocké en clair", async () => {
    const u = await createUser();
    const token = await loginAs(u);
    const rows = await sql("select id from sessions where id = $1", [token]);
    expect(rows).toHaveLength(0);
  });

  it("refuse un mauvais mot de passe ou un compte inconnu, avec le même message", async () => {
    const u = await createUser();
    const bad = await call(login.POST, { body: { schoolId: u.schoolId, password: "faux" } });
    const unknown = await call(login.POST, { body: { schoolId: "inconnu", password: "faux" } });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.json.error.code).toBe("INVALID_CREDENTIALS");
    expect(unknown.json.error.message).toBe(bad.json.error.message);
  });

  it("refuse un compte suspendu", async () => {
    const u = await createUser();
    await sql("update users set status = 'suspended' where id = $1", [u.id]);
    const res = await call(login.POST, { body: { schoolId: u.schoolId, password: u.password } });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("ACCOUNT_SUSPENDED");
  });

  it("valide les entrées", async () => {
    expect((await call(login.POST, { body: { schoolId: "" } })).status).toBe(422);
    expect((await call(login.POST, { body: "pas du json" })).status).toBe(400);
  });

  it("limite les tentatives par compte (429 + Retry-After)", async () => {
    const u = await createUser();
    for (let i = 0; i < 10; i++) {
      expect((await call(login.POST, { body: { schoolId: u.schoolId, password: "faux" } })).status).toBe(401);
    }
    const res = await call(login.POST, { body: { schoolId: u.schoolId, password: u.password } });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("session", () => {
  it("/api/auth/me renvoie l'utilisateur connecté, 401 sinon", async () => {
    const u = await createUser();
    const token = await loginAs(u);
    expect((await call(me.GET, { token })).json.user.id).toBe(u.id);
    expect((await call(me.GET)).status).toBe(401);
    expect((await call(me.GET, { token: "jeton-invalide" })).status).toBe(401);
  });

  it("la déconnexion invalide la session", async () => {
    const token = await loginAs(await createUser());
    expect((await call(logout.POST, { token })).status).toBe(200);
    expect((await call(me.GET, { token })).status).toBe(401);
  });

  it("une session expirée est refusée", async () => {
    const token = await loginAs(await createUser());
    await sql("update sessions set expires_at = now() - interval '1 minute'");
    expect((await call(me.GET, { token })).status).toBe(401);
  });

  it("la suspension coupe l'accès immédiatement", async () => {
    const u = await createUser();
    const token = await loginAs(u);
    await sql("update users set status = 'suspended' where id = $1", [u.id]);
    expect((await call(me.GET, { token })).status).toBe(401);
  });
});

describe("mot de passe temporaire", () => {
  it("bloque les actions tant qu'il n'est pas changé", async () => {
    const u = await createUser({ mustChangePassword: true });
    const token = await loginAs(u);
    const blocked = await call(reservations.POST, { token, body: { targetMachineId: 1 } });
    expect(blocked.status).toBe(403);
    expect(blocked.json.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await call(me.GET, { token })).json.user.mustChangePassword).toBe(true);

    expect(
      (
        await call(password.POST, {
          token,
          body: { currentPassword: "faux", newPassword: "nouveau-mdp-123" },
        })
      ).status,
    ).toBe(401);
    expect(
      (await call(password.POST, { token, body: { currentPassword: u.password, newPassword: "court" } }))
        .status,
    ).toBe(422);
    const ok = await call(password.POST, {
      token,
      body: { currentPassword: u.password, newPassword: "nouveau-mdp-123" },
    });
    expect(ok.status).toBe(200);
    expect((await call(reservations.POST, { token, body: { targetMachineId: 1 } })).status).toBe(201);
    await loginAs({ schoolId: u.schoolId, password: "nouveau-mdp-123" });
  });
});

describe("protection CSRF", () => {
  it("refuse une action venant d'une autre origine, ou sans origine", async () => {
    const token = await loginAs(await createUser());
    const other = await call(reservations.POST, {
      token,
      body: { targetMachineId: 2 },
      origin: "https://attaquant.example",
    });
    expect(other.status).toBe(403);
    expect(other.json.error.code).toBe("BAD_ORIGIN");
    expect(
      (await call(reservations.POST, { token, body: { targetMachineId: 2 }, origin: null })).status,
    ).toBe(403);
  });
});
