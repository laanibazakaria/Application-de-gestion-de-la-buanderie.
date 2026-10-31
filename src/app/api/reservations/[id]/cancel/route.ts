import { route, uuidParam } from "@/server/http/route";
import { cancelReservation } from "@/server/services/laundry-service";

/** Annulation (étudiant : la sienne ; admin : retrait de la file). */
export const POST = route({ auth: "user" }, ({ user, params }) => cancelReservation(user, uuidParam(params)));
