import { importCsvSchema } from "@/lib/validation";
import { json, route } from "@/server/http/route";
import { importStudents } from "@/server/services/user-service";

/** Import CSV (tout ou rien). */
export const POST = route({ auth: "admin", body: importCsvSchema }, async ({ user, body }) => {
  const result = await importStudents(user, body.csv);
  return json(result, { status: result.errors.length ? 422 : 201 });
});
