/**
 * Crée un compte administrateur (premier compte en production, ou compte de secours).
 *
 *   pnpm admin:create --identifiant responsable --prenom Fatima --nom Alaoui
 *
 * Affiche un mot de passe temporaire, à changer à la première connexion.
 * Fonctionne sur la base désignée par DATABASE_URL (locale ou Neon).
 */
import "dotenv/config";

import { parseArgs } from "node:util";

import { Pool } from "pg";

const { values } = parseArgs({
  options: {
    identifiant: { type: "string" },
    prenom: { type: "string" },
    nom: { type: "string" },
  },
});

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL n'est pas définie.");
  const { identifiant, prenom, nom } = values;
  if (!identifiant || !prenom || !nom) {
    throw new Error("Usage : pnpm admin:create --identifiant <id> --prenom <prénom> --nom <nom>");
  }
  const { userFieldsSchema } = await import("../src/lib/validation");
  const fields = userFieldsSchema.parse({ schoolId: identifiant, firstName: prenom, lastName: nom });
  const { generateTemporaryPassword, hashPassword } = await import("../src/server/auth/password");
  const password = generateTemporaryPassword(12);

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<{ id: string }>(
      `insert into users (role, school_id, first_name, last_name, password_hash, must_change_password)
       values ('admin', $1, $2, $3, $4, true) returning id`,
      [fields.schoolId, fields.firstName, fields.lastName, await hashPassword(password)],
    );
    await pool.query(
      `insert into activity_log (action, entity_type, entity_id, details) values ('user.created', 'user', $1, $2)`,
      [rows[0]!.id, JSON.stringify({ role: "admin", schoolId: fields.schoolId, via: "cli" })],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23505")
      throw new Error(`L'identifiant « ${fields.schoolId} » existe déjà.`);
    throw err;
  } finally {
    await pool.end();
  }
  console.log(`
Administrateur créé.
  Identifiant            : ${fields.schoolId}
  Mot de passe temporaire : ${password}
À changer à la première connexion.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
