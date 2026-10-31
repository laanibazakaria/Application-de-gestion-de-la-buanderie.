import { Pool } from "pg";

import { E2E_DATABASE_URL } from "../../playwright.config";
import { hashPassword } from "../../src/server/auth/password";
import { runMigrations } from "../../src/server/db/migrate";

import { ADMIN, PASSWORD, STUDENTS } from "./fixtures";

/** Base de bout en bout recréée à chaque lancement, avec les comptes de test. Locale uniquement. */
export default async function globalSetup() {
  const host = new URL(E2E_DATABASE_URL).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`E2E_DATABASE_URL doit pointer vers localhost (reçu : ${host}).`);
  }
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    await pool.query(
      "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;",
    );
    await runMigrations(E2E_DATABASE_URL);
    const hash = await hashPassword(PASSWORD);
    await pool.query(
      `insert into users (role, school_id, first_name, last_name, password_hash, must_change_password)
       values ('admin', $1, 'Responsable', 'Test', $2, false)`,
      [ADMIN, hash],
    );
    for (const s of STUDENTS) {
      await pool.query(
        `insert into users (role, school_id, first_name, last_name, room, password_hash, must_change_password)
         values ('student', $1, $2, $3, $4, $5, $6)`,
        [s.id, s.firstName, s.lastName, s.room, hash, s.mustChangePassword ?? false],
      );
    }
  } finally {
    await pool.end();
  }
}
