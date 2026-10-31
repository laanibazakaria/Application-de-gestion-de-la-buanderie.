import { extendCycleSchema } from "@/lib/validation";
import { route, uuidParam } from "@/server/http/route";
import { extendCycle } from "@/server/services/laundry-service";

export const POST = route({ auth: "admin", body: extendCycleSchema }, ({ user, body, params }) =>
  extendCycle(user, uuidParam(params), body.minutes),
);
