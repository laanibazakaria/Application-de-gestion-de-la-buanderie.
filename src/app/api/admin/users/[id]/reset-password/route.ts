import { route, uuidParam } from "@/server/http/route";
import { resetPassword } from "@/server/services/user-service";

export const POST = route({ auth: "admin" }, ({ user, params }) => resetPassword(user, uuidParam(params)));
