import { reserveSchema } from "@/lib/validation";
import { json, route } from "@/server/http/route";
import { reserve } from "@/server/services/laundry-service";

/** L'étudiant réserve une machine précise ou la première disponible. */
export const POST = route({ auth: "student", body: reserveSchema }, async ({ user, body }) =>
  json(await reserve(user, body.targetMachineId), { status: 201 }),
);
