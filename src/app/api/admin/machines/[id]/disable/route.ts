import { machineIdParam, route } from "@/server/http/route";
import { disableMachine } from "@/server/services/laundry-service";

export const POST = route({ auth: "admin" }, ({ user, params }) =>
  disableMachine(user, machineIdParam(params)),
);
