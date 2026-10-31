import { clearSessionCookie, deleteSession } from "@/server/auth/session";
import { json, route } from "@/server/http/route";

export const POST = route(
  { auth: "user", allowPendingPasswordChange: true, rateLimit: false },
  async ({ sessionToken }) => {
    if (sessionToken) await deleteSession(sessionToken);
    return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
  },
);
