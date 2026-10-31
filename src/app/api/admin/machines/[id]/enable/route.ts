import { machineIdParam, route } from "@/server/http/route";
import { enableMachine } from "@/server/services/laundry-service";

export const POST = route({ auth: "admin" }, ({ user, params }) =>
  enableMachine(user, machineIdParam(params)),
);
