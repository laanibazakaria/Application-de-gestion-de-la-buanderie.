import { route, uuidParam } from "@/server/http/route";
import { confirmPresence } from "@/server/services/laundry-service";

/** « Je suis là » (étudiant appelé, ou admin pour lui). */
export const POST = route({ auth: "user" }, ({ user, params }) => confirmPresence(user, uuidParam(params)));
