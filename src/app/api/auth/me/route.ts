import { route } from "@/server/http/route";

export const GET = route({ auth: "user", allowPendingPasswordChange: true }, ({ user }) => ({ user }));
