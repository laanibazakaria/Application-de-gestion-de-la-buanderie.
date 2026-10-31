import { route, uuidParam } from "@/server/http/route";
import { setUserStatus } from "@/server/services/user-service";

export const POST = route({ auth: "admin" }, ({ user, params }) =>
  setUserStatus(user, uuidParam(params), "active"),
);
