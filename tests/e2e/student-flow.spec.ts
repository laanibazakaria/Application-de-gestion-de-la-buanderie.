import { advanceMinutes, expect, nudge, phone, test } from "./fixtures";

test.describe("parcours étudiant", () => {
  test("réserver → être appelé → « Je suis là » → lancer le cycle → fin du cycle", async ({
    browser,
    request,
  }) => {
    const page = await phone(browser, "E2E-001");
    await expect(page.getByTestId("free-count")).toHaveText("7 machines libres");

    // Réserver la machine 2 (libre) : l'étudiante est appelée tout de suite.
    await page.getByRole("button", { name: "Réserver la Machine 2" }).click();
    const alert = page.getByTestId("call-alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("C'est votre tour ! Présentez-vous à la machine 2");
    await expect(alert.getByRole("timer")).toHaveText(/^[45]:\d\d$/);
    await expect(page.getByTestId("machine-2")).toHaveAttribute("data-status", "awaiting_student");

    // « Je suis là » depuis l'alerte plein écran.
    await alert.getByRole("button", { name: "Je suis là" }).click();
    await expect(alert).toBeHidden();
    const mine = page.getByTestId("my-reservation");
    await expect(mine).toHaveAttribute("data-status", "confirmed");
    await expect(mine).toContainText("Temps restant pour lancer le cycle");

    // Choisir 30 minutes et lancer.
    await mine.getByText("30 min").click();
    await mine.getByRole("button", { name: "Lancer mon cycle" }).click();
    const cycle = page.getByTestId("my-cycle");
    await expect(cycle).toContainText("Votre cycle est en cours — Machine 2");
    await expect(cycle.getByRole("timer")).toHaveText(/^(30:00|29:\d\d)$/);
    await expect(page.getByTestId("machine-2")).toHaveAttribute("data-status", "running");

    // 30 minutes plus tard (horloge du serveur), le cycle se termine.
    await advanceMinutes(request, 31);
    await nudge(page);
    await expect(
      page.getByRole("alert").filter({ hasText: "Votre cycle est terminé sur la machine 2" }),
    ).toBeVisible();
    await expect(page.getByTestId("machine-2")).toHaveAttribute("data-status", "free");
    await expect(page.getByTestId("my-cycle")).toBeHidden();

    // L'historique contient le cycle.
    await page.getByRole("link", { name: "Historique" }).click();
    await expect(page.getByRole("heading", { name: "Mes cycles" })).toBeVisible();
    await expect(page.getByText("30 min · Terminé")).toBeVisible();
  });

  test("« première machine disponible » attribue la première machine qui se libère", async ({ browser }) => {
    const a = await phone(browser, "E2E-001");
    await a.getByRole("button", { name: "Première machine disponible" }).click();
    await expect(a.getByTestId("call-alert")).toContainText("machine 1");
    const b = await phone(browser, "E2E-002");
    await b.getByRole("button", { name: "Première machine disponible" }).click();
    await expect(b.getByTestId("call-alert")).toContainText("machine 2");
  });

  test("annulation par l'étudiant en file", async ({ browser }) => {
    const a = await phone(browser, "E2E-001");
    await a.getByRole("button", { name: "Réserver la Machine 5" }).click();
    await a.getByTestId("call-alert").getByRole("button", { name: "J'ai compris" }).click();
    const b = await phone(browser, "E2E-002", "/ma-reservation");
    await expect(b.getByText("Vous n'avez aucune réservation en cours.")).toBeVisible();
    await b.goto("/");
    await b.getByRole("button", { name: "Réserver la Machine 5" }).click();
    const mine = b.getByTestId("my-reservation");
    await expect(mine).toHaveAttribute("data-status", "waiting");
    await expect(b.getByTestId("my-position")).toHaveText("1");
    await mine.getByRole("button", { name: "Annuler ma réservation" }).click();
    await mine.getByRole("button", { name: "Confirmer l'annulation" }).click();
    await expect(b.getByTestId("my-reservation")).toBeHidden();
  });
});

test.describe("délai de présentation", () => {
  test("sans « Je suis là » en 5 minutes : place perdue automatiquement au profit du suivant", async ({
    browser,
    request,
  }) => {
    const first = await phone(browser, "E2E-001");
    await first.getByRole("button", { name: "Réserver la Machine 3" }).click();
    await expect(first.getByTestId("call-alert")).toBeVisible();

    const second = await phone(browser, "E2E-002");
    await second.getByRole("button", { name: "Réserver la Machine 3" }).click();
    await expect(second.getByTestId("my-position")).toHaveText("1");

    // 4 minutes : avertissement « plus qu'une minute » (sans aucune action de l'étudiante).
    await advanceMinutes(request, 4);
    await nudge(first);
    await expect(first.getByTestId("call-alert")).toContainText("Plus qu'une minute");

    // 5 minutes : aucune action manuelle — le rafraîchissement automatique (3 s, en tête de file)
    // déclenche le traitement de l'échéance par le serveur.
    await advanceMinutes(request, 1);
    await expect(second.getByTestId("call-alert")).toContainText(
      "C'est votre tour ! Présentez-vous à la machine 3",
      {
        timeout: 15_000,
      },
    );
    await expect(first.getByRole("alert").filter({ hasText: "Votre réservation a expiré" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(first.getByTestId("call-alert")).toBeHidden();
    await expect(first.getByTestId("my-reservation")).toBeHidden();
  });

  test("après « Je suis là », 3 minutes pour lancer le cycle, sinon expiration", async ({
    browser,
    request,
  }) => {
    const page = await phone(browser, "E2E-001");
    await page.getByRole("button", { name: "Réserver la Machine 4" }).click();
    await page.getByTestId("call-alert").getByRole("button", { name: "Je suis là" }).click();
    await expect(page.getByTestId("my-reservation")).toHaveAttribute("data-status", "confirmed");
    await advanceMinutes(request, 3);
    await expect(
      page.getByRole("alert").filter({ hasText: "le cycle n'a pas été lancé à temps" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("machine-4")).toHaveAttribute("data-status", "free");
  });
});
