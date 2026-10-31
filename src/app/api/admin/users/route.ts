import { z } from "zod";

import { createUserSchema } from "@/lib/validation";
import { json, route } from "@/server/http/route";
import { createUser, listUsers } from "@/server/services/user-service";

export const GET = route({ auth: "admin" }, async ({ query }) => {
  const role = z
    .enum(["student", "admin"])
    .optional()
    .parse(query.get("role") ?? undefined);
  return { users: await listUsers(role) };
});

/** Création d'un compte avec mot de passe temporaire (affiché une seule fois). */
export const POST = route({ auth: "admin", body: createUserSchema }, async ({ user, body }) =>
  json(await createUser(user, body), { status: 201 }),
);
