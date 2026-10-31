import { Pool } from "pg";

import { hashPassword } from "@/server/auth/password";
import { setTestClockOffset } from "@/server/clock";
import { createDb, type Database } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

export const ORIGIN = "http://localhost:3000";

/** Recrée entièrement la base de test (schéma vide puis migrations), ouverte 24 h/24. */
export async function resetDatabase(url: string = process.env.DATABASE_URL!): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(
      "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;",
    );
  } finally {
    await pool.end();
  }
  await runMigrations(url);
  await sql("update opening_hours set is_open = true, open_minute = 0, close_minute = 1440");
}

let sharedPool: Pool | undefined;
function pool(): Pool {
  sharedPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return sharedPool;
}

export async function sql<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
) {
  return (await pool().query(text, params)).rows as T[];
}

export async function closeTestPools(): Promise<void> {
  await sharedPool?.end();
  sharedPool = undefined;
  const g = globalThis as unknown as { __buanderiePool?: Pool; __buanderieDb?: unknown };
  await g.__buanderiePool?.end();
  g.__buanderiePool = undefined;
  g.__buanderieDb = undefined;
}

export function testDb(): { pool: Pool; db: Database } {
  const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  return { pool: p, db: createDb(p) };
}

/** Avance l'horloge simulée du serveur. */
let offset = 0;
export function resetClock() {
  offset = 0;
  setTestClockOffset(0);
}
export function advanceMinutes(minutes: number) {
  offset += minutes * 60_000;
  setTestClockOffset(offset);
}

let counter = 0;
export async function createUser(
  opts: { role?: "admin" | "student"; password?: string; mustChangePassword?: boolean } = {},
) {
  counter += 1;
  const schoolId = `${opts.role === "admin" ? "ADM" : "E"}${Date.now().toString(36)}${counter}`;
  const password = opts.password ?? "motdepasse-test";
  const [row] = await sql<{ id: string }>(
    `insert into users (role, school_id, first_name, last_name, room, password_hash, must_change_password)
     values ($1, $2, 'Prénom', 'Nom ${counter}', '1${counter}', $3, $4) returning id`,
    [opts.role ?? "student", schoolId, await hashPassword(password), opts.mustChangePassword ?? false],
  );
  return { id: row!.id, schoolId, password };
}

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response> | Response;

export interface CallOptions {
  method?: string;
  body?: unknown;
  token?: string | undefined;
  params?: Record<string, string>;
  query?: string;
  origin?: string | null;
  headers?: Record<string, string>;
}

export async function call(handler: Handler, opts: CallOptions = {}) {
  const headers = new Headers(opts.headers);
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  if (opts.origin !== null && method !== "GET") headers.set("Origin", opts.origin ?? ORIGIN);
  if (opts.token) headers.set("Cookie", `buanderie_session=${opts.token}`);
  if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  headers.set("x-real-ip", headers.get("x-real-ip") ?? "10.0.0.1");
  const req = new Request(`${ORIGIN}/api/test${opts.query ? `?${opts.query}` : ""}`, {
    method,
    headers,
    body:
      opts.body === undefined
        ? undefined
        : typeof opts.body === "string"
          ? opts.body
          : JSON.stringify(opts.body),
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = text ? JSON.parse(text) : null;
  return { status: res.status, json, headers: res.headers };
}

/** Connexion via la vraie route ; renvoie le jeton de session du cookie. */
export async function loginAs(user: { schoolId: string; password: string }): Promise<string> {
  const { POST } = await import("@/app/api/auth/login/route");
  const res = await call(POST, { body: { schoolId: user.schoolId, password: user.password } });
  if (res.status !== 200) throw new Error(`Connexion impossible : ${JSON.stringify(res.json)}`);
  const cookie = res.headers.get("set-cookie") ?? "";
  return /buanderie_session=([^;]+)/.exec(cookie)![1]!;
}

export async function studentSession() {
  const u = await createUser();
  return { ...u, token: await loginAs(u) };
}

export async function adminSession() {
  const u = await createUser({ role: "admin" });
  return { ...u, token: await loginAs(u) };
}

/** Occupe toutes les machines par des cycles se terminant à +10, +20, … minutes. */
export async function fillAllMachines() {
  for (let n = 1; n <= 7; n++) {
    const s = await createUser();
    await sql(
      `insert into cycles (id, machine_id, student_id, started_at, planned_duration_min, planned_end_at, status)
       values (gen_random_uuid(), $1, $2, now() - interval '5 minutes', 45, now() + make_interval(mins => $3), 'running')`,
      [n, s.id, n * 10],
    );
    await sql(`update machines set status = 'running' where id = $1`, [n]);
  }
  await sql(`update laundry_state set next_deadline_at = now(), version = version + 1`);
}
