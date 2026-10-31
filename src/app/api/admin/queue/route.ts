import { enqueueSchema } from "@/lib/validation";
import { json, route } from "@/server/http/route";
import { enqueueStudent } from "@/server/services/laundry-service";

/** Ajouter un étudiant dans une file. */
export const POST = route({ auth: "admin", body: enqueueSchema }, async ({ user, body }) =>
  json(await enqueueStudent(user, body.studentId, body.targetMachineId), { status: 201 }),
);
