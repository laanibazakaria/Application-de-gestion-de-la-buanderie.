import { startCycleSchema } from "@/lib/validation";
import { json, route } from "@/server/http/route";
import { startCycle } from "@/server/services/laundry-service";

/** Lancement d'un cycle : l'étudiant présent (si le paramètre l'autorise) ou l'admin. */
export const POST = route({ auth: "user", body: startCycleSchema }, async ({ user, body }) =>
  json(await startCycle(user, body), { status: 201 }),
);
