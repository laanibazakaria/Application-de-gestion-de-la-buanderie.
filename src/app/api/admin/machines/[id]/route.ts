import { updateMachineSchema } from "@/lib/validation";
import { machineIdParam, route } from "@/server/http/route";
import { updateMachine } from "@/server/services/laundry-service";

export const PATCH = route({ auth: "admin", body: updateMachineSchema }, ({ user, body, params }) =>
  updateMachine(user, machineIdParam(params), body),
);
