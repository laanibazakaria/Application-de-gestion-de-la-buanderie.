import { z } from "zod";

import { route } from "@/server/http/route";
import { activity } from "@/server/services/history-service";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  beforeId: z.coerce.number().int().positive().optional(),
  action: z.string().max(60).optional(),
});

export const GET = route({ auth: "admin" }, ({ query }) =>
  activity(querySchema.parse(Object.fromEntries(query))),
);
