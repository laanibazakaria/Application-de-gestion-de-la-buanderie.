import { readCookie, SESSION_COOKIE } from "@/server/auth/session";
import { now } from "@/server/clock";
import { errorResponse, json, toErrorResponse } from "@/server/http/route";
import { settleIfDue } from "@/server/services/laundry-tx";
import { buildState, pollHead, renewSessionIfNeeded } from "@/server/services/state-service";

export const dynamic = "force-dynamic";

/**
 * État de la buanderie, rafraîchi automatiquement par chaque page ouverte.
 *
 * Le client envoie `If-None-Match: "v<version>"` (la version qu'il connaît).
 *  - Rien n'a changé et aucune échéance n'est atteinte → 304 sans corps, après UNE requête SQL.
 *  - Une échéance est atteinte → elle est traitée (une seule fois, sous verrou), puis état complet.
 *  - Sinon → état complet (200).
 * L'en-tête `X-Server-Now` permet au client de corriger le décalage de son horloge, y compris sur un 304.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const at = now();
    const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
    const head = await pollHead(token, at);
    if (!head.viewer || !token) return errorResponse(401, "UNAUTHENTICATED", "Connexion requise");
    if (head.viewer.mustChangePassword) {
      return errorResponse(403, "PASSWORD_CHANGE_REQUIRED", "Changez votre mot de passe temporaire");
    }

    const due = head.nextDeadlineAt !== null && head.nextDeadlineAt.getTime() <= at.getTime();
    if (due) await settleIfDue();

    const etag = `"v${head.version}"`;
    if (!due && req.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": "no-store", "X-Server-Now": at.toISOString() },
      });
    }

    await renewSessionIfNeeded(token, head.viewer.sessionExpiresAt, at);
    const state = await buildState(head.viewer);
    return json(state, { headers: { ETag: `"v${state.version}"`, "X-Server-Now": state.serverNow } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
