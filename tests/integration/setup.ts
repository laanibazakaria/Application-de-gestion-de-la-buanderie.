import "dotenv/config";

/**
 * Garde-fou : les tests d'intégration VIDENT la base. On refuse toute base qui
 * n'est pas locale, pour ne jamais toucher une base Neon par erreur.
 */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL doit être définie pour les tests d'intégration.");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  throw new Error(`TEST_DATABASE_URL doit pointer vers localhost (reçu : ${host}).`);
}
process.env.DATABASE_URL = url;
process.env.APP_URL = "http://localhost:3000";
process.env.CRON_SECRET ??= "x".repeat(40);
if (process.env.CRON_SECRET.length < 32) process.env.CRON_SECRET = "x".repeat(40);
// Horloge simulée : autorisée car base et APP_URL sont locales et on n'est pas sur Vercel.
process.env.E2E_TEST_CLOCK = "1";
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
delete process.env.VERCEL_URL;
