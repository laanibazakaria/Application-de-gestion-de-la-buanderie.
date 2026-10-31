import { afterEach, describe, expect, it, vi } from "vitest";

import { isTestClockAllowed, now, setTestClockOffset } from "@/server/clock";

const LOCAL = {
  E2E_TEST_CLOCK: "1",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  APP_URL: "http://localhost:3000",
} as unknown as NodeJS.ProcessEnv;

describe("horloge de test : impossible à activer en production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("autorisée seulement en local avec E2E_TEST_CLOCK=1", () => {
    expect(isTestClockAllowed(LOCAL)).toBe(true);
  });

  it.each([
    ["E2E_TEST_CLOCK absente", { E2E_TEST_CLOCK: undefined }],
    ["E2E_TEST_CLOCK = true", { E2E_TEST_CLOCK: "true" }],
    ["sur Vercel (VERCEL)", { VERCEL: "1" }],
    ["sur Vercel (VERCEL_ENV)", { VERCEL_ENV: "production" }],
    ["sur Vercel (VERCEL_URL)", { VERCEL_URL: "buanderie.vercel.app" }],
    ["base Neon", { DATABASE_URL: "postgres://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db" }],
    ["base sans hôte local", { DATABASE_URL: "postgres://u:p@10.0.0.5/db" }],
    ["URL publique réelle", { APP_URL: "https://buanderie.example.ma" }],
    ["URL invalide", { APP_URL: "pas une url" }],
  ])("refusée : %s", (_label, override) => {
    expect(isTestClockAllowed({ ...LOCAL, ...override } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("le décalage est ignoré et refusé quand l'horloge n'est pas autorisée", () => {
    vi.stubEnv("E2E_TEST_CLOCK", "1");
    vi.stubEnv("VERCEL", "1");
    expect(() => setTestClockOffset(3_600_000)).toThrow();
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it("applique le décalage quand il est autorisé", () => {
    vi.stubEnv("E2E_TEST_CLOCK", "1");
    vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("VERCEL_URL", "");
    setTestClockOffset(3_600_000);
    expect(now().getTime() - Date.now()).toBeGreaterThan(3_599_000);
    setTestClockOffset(0);
  });
});
