import { changePasswordSchema } from "@/lib/validation";
import { route } from "@/server/http/route";
import { changeOwnPassword } from "@/server/services/auth-service";

export const POST = route(
  { auth: "user", body: changePasswordSchema, allowPendingPasswordChange: true },
  ({ user, body, sessionToken }) =>
    changeOwnPassword(user, body.currentPassword, body.newPassword, sessionToken),
);
