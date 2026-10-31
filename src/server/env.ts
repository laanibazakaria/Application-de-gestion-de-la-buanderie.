import "server-only";
import { z } from "zod";

/**
 * Variables d'environnement validées au démarrage.
 * Toute valeur manquante ou invalide fait échouer la première requête avec un message clair.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  CRON_SECRET: z.string().min(32, "CRON_SECRET doit faire au moins 32 caractères"),
  APP_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Configuration invalide : ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
