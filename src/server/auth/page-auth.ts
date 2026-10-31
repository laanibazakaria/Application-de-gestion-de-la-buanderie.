import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { Role } from "../domain/types";

import { getSessionUser, SESSION_COOKIE, type AuthUser } from "./session";

/** Utilisateur connecté pour une page serveur, ou `null`. */
export async function getPageUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(token);
}

/**
 * Exige une session valide (contrôle côté serveur, à chaque rendu de page) :
 * sinon redirection vers la connexion, ou vers le changement de mot de passe.
 */
export async function requirePageUser(
  opts: { role?: Role; allowPendingPasswordChange?: boolean } = {},
): Promise<AuthUser> {
  const user = await getPageUser();
  if (!user) redirect("/connexion");
  if (user.mustChangePassword && !opts.allowPendingPasswordChange) redirect("/mot-de-passe");
  if (opts.role && user.role !== opts.role) redirect("/");
  return user;
}
