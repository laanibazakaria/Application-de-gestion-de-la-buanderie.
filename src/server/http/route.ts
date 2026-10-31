import { z } from "zod";

import { getSessionUser, readCookie, SESSION_COOKIE, type AuthUser } from "../auth/session";
import { pgErrorCode } from "../db/errors";
import { DomainError } from "../domain/errors";
import { enforceRateLimit, RULES } from "../rate-limit";

import { forbidden, HttpError, unauthorized } from "./errors";

/**
 * - `public` : sans connexion (page de connexion, tâche planifiée qui a son propre secret) ;
 * - `user` : tout utilisateur connecté ;
 * - `student` / `admin` : rôle exigé.
 */
export type AuthMode = "public" | "user" | "student" | "admin";

type UserFor<M extends AuthMode> = M extends "public" ? AuthUser | null : AuthUser;

export interface RouteContext<M extends AuthMode, B> {
  req: Request;
  user: UserFor<M>;
  body: B;
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string;
  sessionToken: string | undefined;
}

export interface RouteOptions<M extends AuthMode, S extends z.ZodType | undefined> {
  auth: M;
  body?: S;
  /** Autoriser l'accès alors que le mot de passe temporaire n'a pas encore été changé. */
  allowPendingPasswordChange?: boolean;
  /** Limitation par utilisateur des actions (par défaut : activée pour toute méthode autre que GET). */
  rateLimit?: boolean;
}

type NextContext = { params: Promise<Record<string, string | string[]>> };
type Handler = (req: Request, ctx: NextContext) => Promise<Response>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return json({ error: { code, message, ...extra } }, { status, headers });
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  );
}

/**
 * Protection CSRF : en plus du cookie SameSite=Lax, toute requête qui modifie
 * l'état doit venir de l'application elle-même : l'en-tête Origin (posé par le
 * navigateur, impossible à falsifier depuis un autre site) doit être APP_URL ou
 * l'hôte même de la requête (utile pour les déploiements de prévisualisation Vercel).
 */
function checkOrigin(req: Request): void {
  if (SAFE_METHODS.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) throw forbidden("BAD_ORIGIN");
  const allowed = new Set<string>();
  if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  if (!allowed.has(origin)) throw forbidden("BAD_ORIGIN");
}

/**
 * Enveloppe commune à toutes les routes API :
 * contrôle d'origine → authentification → rôle → limitation → validation du corps → gestionnaire
 * → traduction des erreurs (métier, validation, HTTP) en réponses JSON.
 */
export function route<M extends AuthMode, S extends z.ZodType | undefined = undefined>(
  options: RouteOptions<M, S>,
  handler: (
    ctx: RouteContext<M, S extends z.ZodType ? z.infer<S> : undefined>,
  ) => Promise<Response | object> | Response | object,
): Handler {
  return async (req, nextCtx) => {
    try {
      checkOrigin(req);
      const sessionToken = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
      const user = options.auth === "public" && !sessionToken ? null : await getSessionUser(sessionToken);

      if (options.auth !== "public") {
        if (!user) throw unauthorized();
        if (options.auth !== "user" && user.role !== options.auth) throw forbidden();
        if (user.mustChangePassword && !options.allowPendingPasswordChange)
          throw forbidden("PASSWORD_CHANGE_REQUIRED");
      }

      if (user && (options.rateLimit ?? !SAFE_METHODS.has(req.method))) {
        await enforceRateLimit(RULES.actionsPerUser, user.id);
      }

      let body: unknown = undefined;
      if (options.body) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          throw new HttpError(400, "INVALID_JSON", "Corps de requête JSON invalide");
        }
        body = options.body.parse(raw);
      }

      const rawParams = nextCtx?.params ? await nextCtx.params : {};
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawParams)) params[k] = Array.isArray(v) ? v.join("/") : v;

      const result = await handler({
        req,
        user: user as UserFor<M>,
        body: body as S extends z.ZodType ? z.infer<S> : undefined,
        params,
        query: new URL(req.url).searchParams,
        ip: clientIp(req),
        sessionToken,
      });
      return result instanceof Response ? result : json(result);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export function toErrorResponse(err: unknown): Response {
  if (err instanceof DomainError) {
    return errorResponse(
      err.httpStatus,
      err.code,
      err.message,
      err.details ? { details: err.details } : undefined,
    );
  }
  if (err instanceof HttpError)
    return errorResponse(err.status, err.code, err.message, undefined, err.headers);
  if (err instanceof z.ZodError) {
    return errorResponse(422, "INVALID_INPUT", "Données invalides", {
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  // Violation d'une contrainte de la base : l'état a changé entre-temps (filet de sécurité).
  const code = pgErrorCode(err);
  if (code === "23505" || code === "23514") {
    return errorResponse(409, "CONFLICT", "Conflit avec une autre action, réessayez");
  }
  console.error(err);
  return errorResponse(500, "INTERNAL", "Erreur interne");
}

/** Paramètre d'URL validé (identifiant). */
export function uuidParam(params: Record<string, string>, name = "id"): string {
  return z.uuid().parse(params[name]);
}

export function machineIdParam(params: Record<string, string>, name = "id"): number {
  return z.coerce.number().int().min(1).max(7).parse(params[name]);
}
