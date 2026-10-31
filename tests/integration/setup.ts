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
