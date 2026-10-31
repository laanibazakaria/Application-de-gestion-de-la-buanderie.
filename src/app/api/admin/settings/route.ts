import { updateSettingsSchema } from "@/lib/validation";
import { route } from "@/server/http/route";
import { getSettings, updateSettings } from "@/server/services/settings-service";

export const GET = route({ auth: "admin" }, () => getSettings());

export const PUT = route({ auth: "admin", body: updateSettingsSchema }, ({ user, body }) =>
  updateSettings(user, body),
);
