import { eq, sql } from "drizzle-orm";

import { dummyPasswordHash, hashPassword, verifyPassword } from "../auth/password";
import { createSession, deleteUserSessions, type AuthUser } from "../auth/session";
import { now } from "../clock";
import { getDb } from "../db/client";
import { users } from "../db/schema";
import { DomainError } from "../domain/errors";
import { enforceRateLimit, RULES } from "../rate-limit";

import { logActivity } from "./activity";

export async function login(schoolId: string, password: string, ip: string) {
  await enforceRateLimit(RULES.loginPerIp, ip);
  await enforceRateLimit(RULES.loginPerAccount, schoolId.toLowerCase());

  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.schoolId}) = lower(${schoolId})`);
  // On vérifie toujours un mot de passe, même pour un compte inexistant : même temps de réponse.
  const ok = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), password);
  if (!user || !ok) throw new DomainError("INVALID_CREDENTIALS", "Identifiant ou mot de passe incorrect");
  if (user.status !== "active") throw new DomainError("ACCOUNT_SUSPENDED", "Compte suspendu");

  const session = await createSession(user.id);
  await logActivity(
    db,
    { action: "auth.login", actorId: user.id, entityType: "user", entityId: user.id, details: {} },
    now(),
  );
  return {
    session,
    user: {
      id: user.id,
      role: user.role,
      schoolId: user.schoolId,
      firstName: user.firstName,
      lastName: user.lastName,
      room: user.room,
      mustChangePassword: user.mustChangePassword,
    } satisfies AuthUser,
  };
}

/** Changement de son propre mot de passe (obligatoire après un mot de passe temporaire). */
export async function changeOwnPassword(
  user: AuthUser,
  currentPassword: string,
  newPassword: string,
  keepToken?: string,
) {
  const db = getDb();
  const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, user.id));
  if (!row || !(await verifyPassword(row.hash, currentPassword))) {
    throw new DomainError("INVALID_CREDENTIALS", "Mot de passe actuel incorrect");
  }
  if (currentPassword === newPassword)
    throw new DomainError("INVALID_INPUT", "Choisissez un mot de passe différent");
  const at = now();
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false, updatedAt: at })
    .where(eq(users.id, user.id));
  await deleteUserSessions(user.id, keepToken);
  await logActivity(
    db,
    { action: "auth.password_changed", actorId: user.id, entityType: "user", entityId: user.id, details: {} },
    at,
  );
  return { ok: true };
}
