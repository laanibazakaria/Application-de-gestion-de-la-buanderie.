import { loginSchema } from "@/lib/validation";
import { sessionCookie } from "@/server/auth/session";
import { json, route } from "@/server/http/route";
import { login } from "@/server/services/auth-service";

export const POST = route({ auth: "public", body: loginSchema, rateLimit: false }, async ({ body, ip }) => {
  const { session, user } = await login(body.schoolId, body.password, ip);
  return json({ user }, { headers: { "Set-Cookie": sessionCookie(session.token, session.expiresAt) } });
});
