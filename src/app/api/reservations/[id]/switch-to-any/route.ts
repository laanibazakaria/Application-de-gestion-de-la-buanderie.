import { route, uuidParam } from "@/server/http/route";
import { switchToFirstAvailable } from "@/server/services/laundry-service";

/** Basculer en « première disponible ». */
export const POST = route({ auth: "user" }, ({ user, params }) =>
  switchToFirstAvailable(user, uuidParam(params)),
);
