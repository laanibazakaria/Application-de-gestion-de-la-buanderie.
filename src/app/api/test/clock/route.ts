import { getTestClockOffset, isTestClockAllowed, now, setTestClockOffset } from "@/server/clock";
import { testClockSchema } from "@/lib/validation";
import { errorResponse, json } from "@/server/http/route";

export const dynamic = "force-dynamic";

/**
 * Horloge simulée pour les tests de bout en bout UNIQUEMENT.
 * Répond 404 (comme si la route n'existait pas) dès qu'une des conditions de
 * `isTestClockAllowed` n'est pas remplie — c'est toujours le cas sur Vercel.
 */
function notFound(): Response {
  return errorResponse(404, "NOT_FOUND", "Introuvable");
}

export function GET(): Response {
  if (!isTestClockAllowed()) return notFound();
  return json({ now: now().toISOString(), offsetMs: getTestClockOffset() });
}

export async function POST(req: Request): Promise<Response> {
  if (!isTestClockAllowed()) return notFound();
  const parsed = testClockSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(422, "INVALID_INPUT", "Données invalides");
  const offset =
    "offsetMs" in parsed.data ? parsed.data.offsetMs : getTestClockOffset() + parsed.data.advanceMs;
  setTestClockOffset(offset);
  return json({ now: now().toISOString(), offsetMs: offset });
}
