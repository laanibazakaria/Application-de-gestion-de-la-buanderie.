import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, phone, test } from "./fixtures";

/** Contrôle automatique WCAG 2.1 A/AA (contrastes, libellés, rôles, structure) des écrans principaux. */
async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}) : ${v.nodes
        .map((n) => n.target.join(" "))
        .slice(0, 3)
        .join(" | ")}`,
  );
  expect(summary).toEqual([]);
}

test.describe("accessibilité (axe-core, WCAG 2.1 AA)", () => {
  test("connexion", async ({ page }) => {
    await page.goto("/connexion");
    await audit(page);
  });

  test("tableau de bord et « Ma réservation » d'un étudiant appelé", async ({ browser }) => {
    const page = await phone(browser, "E2E-001");
    await page.getByRole("button", { name: "Réserver la Machine 1" }).click();
    await expect(page.getByTestId("call-alert")).toBeVisible();
    await audit(page);
    await page.getByTestId("call-alert").getByRole("button", { name: "J'ai compris" }).click();
    await audit(page);
    await page.goto("/ma-reservation");
    await audit(page);
    await page.goto("/historique");
    await audit(page);
  });

  for (const path of [
    "/admin",
    "/admin/comptes",
    "/admin/parametres",
    "/admin/journal",
    "/admin/statistiques",
  ]) {
    test(`administration ${path}`, async ({ browser }) => {
      const page = await phone(browser, "admin-e2e", path);
      await page.waitForLoadState("networkidle");
      await audit(page);
    });
  }
});
