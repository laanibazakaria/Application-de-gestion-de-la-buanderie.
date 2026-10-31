import { E2E_BASE_URL } from "../../playwright.config";

import { expect, loginByApi, PASSWORD, phone, test } from "./fixtures";

test.describe("accès", () => {
  test("toutes les pages exigent une connexion", async ({ page }) => {
    for (const path of ["/", "/ma-reservation", "/historique", "/admin", "/admin/comptes"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/connexion$/);
    }
  });

  test("connexion par le formulaire ; erreur claire si le mot de passe est faux", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByLabel("Identifiant de l'école").fill("E2E-001");
    await page.getByLabel("Mot de passe").fill("faux");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Identifiant ou mot de passe incorrect.",
    );
    await page.getByLabel("Mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByTestId("machine-1")).toBeVisible();
    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/connexion$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/connexion$/);
  });

  test("un étudiant n'accède pas à l'administration", async ({ browser }) => {
    const page = await phone(browser, "E2E-001", "/admin");
    await expect(page).toHaveURL(`${E2E_BASE_URL}/`);
    await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(0);
  });

  test("mot de passe temporaire : changement obligatoire avant d'utiliser la plateforme", async ({
    context,
    page,
  }) => {
    await loginByApi(context, "E2E-NEW");
    await page.goto("/");
    await expect(page).toHaveURL(/\/mot-de-passe$/);
    await page.getByLabel("Mot de passe actuel (temporaire)").fill(PASSWORD);
    await page.getByLabel("Nouveau mot de passe", { exact: true }).fill("nouveau-secret-42");
    await page.getByLabel("Confirmer le nouveau mot de passe").fill("nouveau-secret-42");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByTestId("machine-1")).toBeVisible();
  });
});
