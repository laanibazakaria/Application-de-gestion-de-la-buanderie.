import { markReadSchema } from "@/lib/validation";
import { now } from "@/server/clock";
import { route } from "@/server/http/route";
import { markNotificationsRead } from "@/server/services/history-service";

export const POST = route({ auth: "user", body: markReadSchema, rateLimit: false }, ({ user, body }) =>
  markNotificationsRead(user.id, body.upToId, now()),
);
