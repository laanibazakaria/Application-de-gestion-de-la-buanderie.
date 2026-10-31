import { moveSchema } from "@/lib/validation";
import { route, uuidParam } from "@/server/http/route";
import { moveReservation } from "@/server/services/laundry-service";

/** Réordonner : placer la réservation juste avant `beforeId` (ou en fin de file). */
export const POST = route({ auth: "admin", body: moveSchema }, ({ user, body, params }) =>
  moveReservation(user, uuidParam(params), body.beforeId),
);
