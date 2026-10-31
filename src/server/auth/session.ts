import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, sql } from "drizzle-orm";

import { now } from "../clock";
import { getDb } from "../db/client";
import { sessions, users } from "../db/schema";
import type { Role } from "../domain/types";

export const SESSION_COOKIE = "buanderie_session";
const SESSION_DAYS = 30;
/** On prolonge la session (glissante) seulement s'il lui reste moins de 15 jours : une écriture au plus tous les 15 jours. */
const RENEW_BELOW_DAYS = 15;
const DAY_MS = 86_400_000;

export interface AuthUser {
  id: string;
  role: Role;
  schoolId: string;
  firstName: string;
  lastName: string;
  room: string | null;
  mustChangePassword: boolean;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now().getTime() + SESSION_DAYS * DAY_MS);
  await getDb()
    .insert(sessions)
    .values({ id: hashToken(token), userId, createdAt: now(), expiresAt });
  return { token, expiresAt };
}

/** Utilisateur actif associé au jeton, ou `null` (session absente, expirée, ou compte suspendu). */
export async function getSessionUser(token: string | undefined): Promise<AuthUser | null> {
  if (!token || token.length > 100) return null;
  const id = hashToken(token);
  const at = now();
  const [row] = await getDb()
    .select({
      id: users.id,
      role: users.role,
      schoolId: users.schoolId,
      firstName: users.firstName,
      lastName: users.lastName,
      room: users.room,
      mustChangePassword: users.mustChangePassword,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, at), eq(users.status, "active")));
  if (!row) return null;
  if (row.expiresAt.getTime() - at.getTime() < RENEW_BELOW_DAYS * DAY_MS) {
    await getDb()
      .update(sessions)
      .set({ expiresAt: new Date(at.getTime() + SESSION_DAYS * DAY_MS) })
      .where(eq(sessions.id, id));
  }
  const { expiresAt: _e, ...user } = row;
  return user;
}

export async function deleteSession(token: string): Promise<void> {
  await getDb()
    .delete(sessions)
    .where(eq(sessions.id, hashToken(token)));
}

/** Déconnecte toutes les sessions d'un utilisateur (suspension, nouveau mot de passe). */
export async function deleteUserSessions(userId: string, exceptToken?: string): Promise<void> {
  await getDb()
    .delete(sessions)
    .where(
      exceptToken
        ? and(eq(sessions.userId, userId), sql`${sessions.id} <> ${hashToken(exceptToken)}`)
        : eq(sessions.userId, userId),
    );
}

export async function purgeExpiredSessions(): Promise<void> {
  await getDb()
    .delete(sessions)
    .where(sql`${sessions.expiresAt} < ${now()}`);
}

function isSecureContext(appUrl: string | undefined): boolean {
  if (!appUrl) return true;
  const url = new URL(appUrl);
  return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

export function sessionCookie(token: string, expiresAt: Date): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (isSecureContext(process.env.APP_URL)) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecureContext(process.env.APP_URL)) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
