import { expect, phone, test } from "./fixtures";

test.describe("synchronisation entre téléphones (rafraîchissement automatique, sans action)", () => {
  test("une réservation apparaît sur les autres téléphones et chez l'administrateur", async ({ browser }) => {
    // B est 2e dans une file → rafraîchissement toutes les 5 s ; l'administrateur aussi (5 s).
    const first = await phone(browser, "E2E-001");
    await first.getByRole("button", { name: "Réserver la Machine 1" }).click();
    const b = await phone(browser, "E2E-002");
    await b.getByRole("button", { name: "Réserver la Machine 1" }).click();
    const c = await phone(browser, "E2E-003");
    await c.getByRole("button", { name: "Réserver la Machine 1" }).click();
    await expect(b.getByTestId("my-position")).toHaveText("1");

    const admin = await phone(browser, "admin-e2e", "/admin");
    await expect(admin.getByTestId("admin-machine-6")).toHaveAttribute("data-status", "free");

    const started = Date.now();
    const d = await phone(browser, "E2E-004");
    await d.getByRole("button", { name: "Réserver la Machine 6" }).click();
    await expect(d.getByTestId("call-alert")).toBeVisible();

    await expect(b.getByTestId("machine-6")).toHaveAttribute("data-status", "awaiting_student", {
      timeout: 7_000,
    });
    await expect(admin.getByTestId("admin-machine-6")).toContainText("Appelé : Driss Daoudi", {
      timeout: 7_000,
    });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(8_000);
  });

  test("hors ligne : bandeau, puis resynchronisation automatique au retour du réseau", async ({
    browser,
  }) => {
    const watcher = await phone(browser, "E2E-001");
    await expect(watcher.getByTestId("machine-7")).toHaveAttribute("data-status", "free");
    await watcher.context().setOffline(true);
    await watcher.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(watcher.getByTestId("sync-banner")).toContainText("Hors ligne");

    // Pendant la coupure, quelqu'un réserve la machine 7.
    const other = await phone(browser, "E2E-002");
    await other.getByRole("button", { name: "Réserver la Machine 7" }).click();
    await expect(other.getByTestId("call-alert")).toBeVisible();

    await watcher.context().setOffline(false);
    await watcher.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(watcher.getByTestId("sync-banner")).toBeHidden();
    await expect(watcher.getByTestId("machine-7")).toHaveAttribute("data-status", "awaiting_student");
  });

  test("onglet caché : aucune requête ; rafraîchi dès qu'il redevient visible", async ({ browser }) => {
    const page = await phone(browser, "E2E-001");
    let requests = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/state")) requests++;
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(16_000);
    expect(requests).toBe(0);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => requests, { timeout: 3_000 }).toBeGreaterThan(0);
  });
});
