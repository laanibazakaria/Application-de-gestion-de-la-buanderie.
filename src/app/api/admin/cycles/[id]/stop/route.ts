import { stopCycleSchema } from "@/lib/validation";
import { route, uuidParam } from "@/server/http/route";
import { stopCycle } from "@/server/services/laundry-service";

/** Terminer plus tôt (`ended_early`) ou annuler (`cancelled`). */
export const POST = route({ auth: "admin", body: stopCycleSchema }, ({ user, body, params }) =>
  stopCycle(user, uuidParam(params), body.mode),
);
