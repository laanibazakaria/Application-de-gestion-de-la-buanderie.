import { z } from "zod";

import { route } from "@/server/http/route";
import { getStats } from "@/server/services/stats-service";

export const GET = route({ auth: "admin" }, ({ query }) =>
  getStats(
    z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .parse(query.get("days") ?? undefined),
  ),
);
