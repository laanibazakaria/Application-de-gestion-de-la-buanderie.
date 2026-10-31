import { updateUserSchema } from "@/lib/validation";
import { route, uuidParam } from "@/server/http/route";
import { updateUser } from "@/server/services/user-service";

export const PATCH = route({ auth: "admin", body: updateUserSchema }, ({ user, body, params }) =>
  updateUser(user, uuidParam(params), body),
);
