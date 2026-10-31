import { route } from "@/server/http/route";
import { myHistory } from "@/server/services/history-service";

export const GET = route({ auth: "user" }, ({ user }) => myHistory(user));
