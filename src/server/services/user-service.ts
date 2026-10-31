/** Gestion des comptes par l'administrateur. */
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import { parseCsv } from "@/lib/csv";
import { userFieldsSchema } from "@/lib/validation";

import { generateTemporaryPassword, hashPassword } from "../auth/password";
import { deleteUserSessions, type AuthUser } from "../auth/session";
import { now } from "../clock";
import { getDb } from "../db/client";
import { pgErrorCode } from "../db/errors";
import { reservations, users } from "../db/schema";
import { DomainError } from "../domain/errors";
import type { Role } from "../domain/types";

import { logActivity } from "./activity";
import { actorOf } from "./laundry-service";
import { loadSettings, withLaundry } from "./laundry-tx";

export interface UserListItem {
  id: string;
  role: Role;
  schoolId: string;
  firstName: string;
  lastName: string;
  room: string | null;
  status: "active" | "suspended";
  mustChangePassword: boolean;
  createdAt: string;
  /** Absences (réservations expirées sans présentation) sur la période paramétrée. */
  noShowCount: number;
  /** Seuil d'avertissement atteint (3 absences ou plus sur 30 jours par défaut). */
  noShowWarning: boolean;
}

export async function listUsers(role?: Role): Promise<UserListItem[]> {
  const db = getDb();
  const settings = await loadSettings(db);
  const since = new Date(now().getTime() - settings.noShowWindowDays * 86_400_000);
  const noShows = db
    .select({ studentId: reservations.studentId, n: sql<number>`count(*)::int`.as("n") })
    .from(reservations)
    .where(and(eq(reservations.closeReason, "no_show"), gt(reservations.closedAt, since)))
    .groupBy(reservations.studentId)
    .as("no_shows");
  const rows = await db
    .select({
      id: users.id,
      role: users.role,
      schoolId: users.schoolId,
      firstName: users.firstName,
      lastName: users.lastName,
      room: users.room,
      status: users.status,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
      noShowCount: sql<number>`coalesce(${noShows.n}, 0)`,
    })
    .from(users)
    .leftJoin(noShows, eq(noShows.studentId, users.id))
    .where(role ? eq(users.role, role) : undefined)
    .orderBy(asc(users.lastName), asc(users.firstName));
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    noShowCount: Number(r.noShowCount),
    noShowWarning: Number(r.noShowCount) >= settings.noShowWarningThreshold,
  }));
}

export interface NewUserInput {
  role: Role;
  schoolId: string;
  firstName: string;
  lastName: string;
  room?: string | null | undefined;
}

export async function createUser(admin: AuthUser, input: NewUserInput) {
  const temporaryPassword = generateTemporaryPassword();
  const at = now();
  const db = getDb();
  try {
    const [row] = await db
      .insert(users)
      .values({
        role: input.role,
        schoolId: input.schoolId,
        firstName: input.firstName,
        lastName: input.lastName,
        room: input.room ?? null,
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        createdAt: at,
        updatedAt: at,
      })
      .returning({ id: users.id });
    await logActivity(
      db,
      {
        action: "user.created",
        actorId: admin.id,
        entityType: "user",
        entityId: row!.id,
        details: { role: input.role, schoolId: input.schoolId },
      },
      at,
    );
    return { id: row!.id, temporaryPassword };
  } catch (err) {
    if (pgErrorCode(err) === "23505") throw new DomainError("SCHOOL_ID_TAKEN", "Identifiant déjà utilisé");
    throw err;
  }
}

const CSV_HEADERS: Record<string, keyof NewUserInput> = {
  nom: "lastName",
  prenom: "firstName",
  prénom: "firstName",
  chambre: "room",
  identifiant: "schoolId",
};

export interface ImportResult {
  created: Array<{
    schoolId: string;
    firstName: string;
    lastName: string;
    room: string | null;
    temporaryPassword: string;
  }>;
  errors: Array<{ line: number; message: string }>;
}

/**
 * Import CSV d'étudiants. Colonnes attendues (en-tête, ordre libre) : nom, prénom, chambre, identifiant.
 * Tout ou rien : si une ligne est invalide ou un identifiant déjà pris, aucun compte n'est créé.
 */
export async function importStudents(admin: AuthUser, csv: string): Promise<ImportResult> {
  const rows = parseCsv(csv);
  const [header, ...lines] = rows;
  const errors: ImportResult["errors"] = [];
  if (!header) return { created: [], errors: [{ line: 1, message: "Fichier vide" }] };

  const columns = header.map((h) => CSV_HEADERS[h.trim().toLowerCase()]);
  for (const required of ["lastName", "firstName", "schoolId"] as const) {
    if (!columns.includes(required))
      errors.push({
        line: 1,
        message: `Colonne manquante : ${required === "lastName" ? "nom" : required === "firstName" ? "prénom" : "identifiant"}`,
      });
  }
  if (errors.length) return { created: [], errors };
  if (lines.length > 1000) return { created: [], errors: [{ line: 1, message: "1000 lignes au maximum" }] };

  const parsed: Array<{ line: number; data: NewUserInput }> = [];
  const seen = new Set<string>();
  lines.forEach((cells, i) => {
    const line = i + 2;
    const record: Record<string, string> = {};
    columns.forEach((key, c) => {
      if (key) record[key] = (cells[c] ?? "").trim();
    });
    const result = userFieldsSchema.safeParse({ ...record, room: record.room || null });
    if (!result.success) {
      errors.push({
        line,
        message: result.error.issues.map((x) => `${x.path.join(".")} : ${x.message}`).join(", "),
      });
      return;
    }
    const key = result.data.schoolId.toLowerCase();
    if (seen.has(key))
      errors.push({ line, message: `Identifiant en double dans le fichier : ${result.data.schoolId}` });
    seen.add(key);
    parsed.push({ line, data: { ...result.data, role: "student" } });
  });

  const db = getDb();
  if (parsed.length > 0) {
    const existing = await db
      .select({ schoolId: users.schoolId })
      .from(users)
      .where(inArray(sql`lower(${users.schoolId})`, [...seen]));
    for (const e of existing) {
      const p = parsed.find((x) => x.data.schoolId.toLowerCase() === e.schoolId.toLowerCase());
      errors.push({ line: p?.line ?? 0, message: `Identifiant déjà utilisé : ${e.schoolId}` });
    }
  }
  if (errors.length) return { created: [], errors: errors.sort((a, b) => a.line - b.line) };

  const at = now();
  const created: ImportResult["created"] = [];
  const values: Array<typeof users.$inferInsert> = [];
  for (const { data } of parsed) {
    const temporaryPassword = generateTemporaryPassword();
    created.push({
      schoolId: data.schoolId,
      firstName: data.firstName,
      lastName: data.lastName,
      room: data.room ?? null,
      temporaryPassword,
    });
    values.push({
      role: "student" as const,
      schoolId: data.schoolId,
      firstName: data.firstName,
      lastName: data.lastName,
      room: data.room ?? null,
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      createdAt: at,
      updatedAt: at,
    });
  }
  await db.transaction(async (tx) => {
    if (values.length) await tx.insert(users).values(values);
    await logActivity(
      tx,
      {
        action: "user.imported",
        actorId: admin.id,
        entityType: "user",
        entityId: "csv",
        details: { count: values.length },
      },
      at,
    );
  });
  return { created, errors: [] };
}

export async function updateUser(
  admin: AuthUser,
  id: string,
  patch: { firstName?: string; lastName?: string; room?: string | null },
) {
  const db = getDb();
  const at = now();
  const [row] = await db
    .update(users)
    .set({ ...patch, updatedAt: at })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!row) throw new DomainError("NOT_FOUND");
  await logActivity(
    db,
    { action: "user.updated", actorId: admin.id, entityType: "user", entityId: id, details: patch },
    at,
  );
  return { ok: true };
}

/**
 * Suspension : le compte est déconnecté partout et ses réservations actives sont annulées
 * (le suivant de la file est appelé si besoin). La réactivation rétablit simplement l'accès.
 */
export async function setUserStatus(admin: AuthUser, id: string, status: "active" | "suspended") {
  if (id === admin.id)
    throw new DomainError("CANNOT_TARGET_SELF", "Impossible de modifier son propre statut");
  await withLaundry(async ({ tx, engine, now: at, log }) => {
    const [row] = await tx
      .update(users)
      .set({ status, updatedAt: at })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!row) throw new DomainError("NOT_FOUND");
    if (status === "suspended") {
      for (const r of engine.activeReservationList().filter((x) => x.studentId === id)) {
        engine.cancelReservation(actorOf(admin), r.id);
      }
    }
    log({
      action: status === "suspended" ? "user.suspended" : "user.reactivated",
      actorId: admin.id,
      entityType: "user",
      entityId: id,
      details: {},
    });
  });
  if (status === "suspended") await deleteUserSessions(id);
  return { ok: true };
}

export async function resetPassword(admin: AuthUser, id: string) {
  const temporaryPassword = generateTemporaryPassword();
  const db = getDb();
  const at = now();
  const [row] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, updatedAt: at })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!row) throw new DomainError("NOT_FOUND");
  await deleteUserSessions(id);
  await logActivity(
    db,
    { action: "user.password_reset", actorId: admin.id, entityType: "user", entityId: id, details: {} },
    at,
  );
  return { temporaryPassword };
}
