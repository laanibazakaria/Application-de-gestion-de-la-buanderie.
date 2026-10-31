import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout : l'application est construite puis lancée (`next start`) sur une
 * base PostgreSQL LOCALE dédiée, avec l'horloge simulée activée (E2E_TEST_CLOCK=1).
 */
const PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${PORT}`;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://buanderie:buanderie@localhost:5432/buanderie_e2e";
const CRON_SECRET = "e2e-".padEnd(48, "x");

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Une seule base partagée et une horloge serveur unique : les tests s'exécutent l'un après l'autre.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: E2E_BASE_URL,
    locale: "fr-FR",
    timezoneId: "Africa/Casablanca",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "telephone", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? `pnpm start -p ${PORT}` : `pnpm build && pnpm start -p ${PORT}`,
    url: `${E2E_BASE_URL}/connexion`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      APP_URL: E2E_BASE_URL,
      CRON_SECRET,
      E2E_TEST_CLOCK: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
  metadata: { cronSecret: CRON_SECRET },
});
