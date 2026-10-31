import { db, expect, nudge, phone, test } from "./fixtures";

test.describe("espace administrateur", () => {
  test("confirmer la présence et démarrer le cycle d'un étudiant appelé ; prolonger ; terminer → suivant appelé", async ({
    browser,
  }) => {
    const s1 = await phone(browser, "E2E-001");
    await s1.getByRole("button", { name: "Réserver la Machine 2" }).click();
    await s1.getByTestId("call-alert").getByRole("button", { name: "J'ai compris" }).click();
    const s2 = await phone(browser, "E2E-002");
    await s2.getByRole("button", { name: "Réserver la Machine 2" }).click();

    const admin = await phone(browser, "admin-e2e", "/admin");
    const m2 = admin.getByTestId("admin-machine-2");
    await expect(m2).toContainText("Appelé : Amina Alaoui");
    await m2.getByRole("button", { name: "Confirmer la présence" }).click();
    await expect(m2).toContainText("Présent : Amina Alaoui");
    await m2.getByRole("button", { name: /Démarrer pour/ }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByText("60 min").click();
    await dialog.getByRole("button", { name: "Démarrer", exact: true }).click();
    await expect(m2).toHaveAttribute("data-status", "running");
    await expect(m2).toContainText("Cycle de Amina Alaoui");

    // L'étudiante voit son cycle (rafraîchissement automatique, 3 s quand on est appelé).
    await expect(s1.getByTestId("my-cycle")).toContainText("Machine 2", { timeout: 10_000 });

    const endBefore = await m2.getByText(/Fin prévue/).innerText();
    await m2.getByRole("button", { name: "Prolonger de 15 minutes" }).click();
    await expect(m2.getByText(/Fin prévue/)).not.toHaveText(endBefore);

    await m2.getByRole("button", { name: "Terminer", exact: true }).click();
    await m2.getByRole("button", { name: "Confirmer : terminer maintenant" }).click();
    await expect(m2).toContainText("Appelé : Bilal Bennani");
    await expect(s2.getByTestId("call-alert")).toBeVisible({ timeout: 10_000 });
  });

  test("démarrage direct sur une machine libre pour un étudiant présent", async ({ browser }) => {
    const admin = await phone(browser, "admin-e2e", "/admin");
    const m5 = admin.getByTestId("admin-machine-5");
    await m5.getByRole("button", { name: "Démarrer un cycle" }).click();
    const dialog = admin.getByRole("dialog");
    await dialog.getByRole("searchbox").fill("Chraibi");
    await dialog.getByRole("combobox").selectOption({ label: "Chraibi Chaimae — A3 (E2E-003)" });
    await dialog.getByRole("button", { name: "Démarrer", exact: true }).click();
    await expect(m5).toContainText("Cycle de Chaimae Chraibi");
  });

  test("machine hors service avec une file : étudiants prévenus, bascule en « première disponible »", async ({
    browser,
  }) => {
    // L'étudiante est appelée sur la machine 7 (libre), puis la machine tombe en panne.
    const s = await phone(browser, "E2E-001");
    await s.getByRole("button", { name: "Réserver la Machine 7" }).click();
    await s.getByTestId("call-alert").getByRole("button", { name: "J'ai compris" }).click();

    const admin = await phone(browser, "admin-e2e", "/admin");
    const m7 = admin.getByTestId("admin-machine-7");
    await expect(m7).toContainText("Appelé : Amina Alaoui");
    await m7.getByRole("button", { name: "Mettre hors service" }).click();
    await m7.getByRole("button", { name: "Confirmer : hors service" }).click();
    await expect(m7).toHaveAttribute("data-status", "out_of_service");
    // Elle retourne en file, à sa place, sur la machine 7.
    await expect(m7.getByTestId("admin-queue-entry")).toContainText("Amina Alaoui");

    // Elle est prévenue (rafraîchissement automatique) et peut basculer : la machine 1 est libre.
    await expect(s.getByText("La machine 7 est hors service.").first()).toBeVisible({ timeout: 10_000 });
    await s.getByRole("button", { name: "Passer en « première disponible »" }).click();
    await expect(s.getByTestId("call-alert")).toContainText("machine 1");

    await m7.getByRole("button", { name: "Remettre en service" }).click();
    await expect(m7).toHaveAttribute("data-status", "free");
  });

  test("réordonner une file au clavier (glisser-déposer accessible)", async ({ browser }) => {
    // Machine 3 occupée par un cycle, trois étudiants en file.
    await db().query(
      `insert into cycles (id, machine_id, student_id, started_at, planned_duration_min, planned_end_at, status)
       select gen_random_uuid(), 3, id, now(), 45, now() + interval '45 minutes', 'running' from users where school_id = 'E2E-004'`,
    );
    await db().query("update machines set status = 'running' where id = 3");
    await db().query("update laundry_state set version = version + 1");
    for (const id of ["E2E-001", "E2E-002", "E2E-003"]) {
      const p = await phone(browser, id);
      await p.getByRole("button", { name: "Réserver la Machine 3" }).click();
      await expect(p.getByTestId("my-reservation")).toHaveAttribute("data-status", "waiting");
    }
    const admin = await phone(browser, "admin-e2e", "/admin");
    const entries = admin.getByTestId("admin-machine-3").getByTestId("admin-queue-entry");
    await expect(entries).toHaveCount(3);
    await expect(entries.nth(2)).toContainText("Chaimae Chraibi");

    // Poignée de la 3e entrée : Espace pour saisir, deux fois Haut, Espace pour déposer.
    await entries
      .nth(2)
      .getByRole("button", { name: /Glisser pour réordonner Chaimae/ })
      .focus();
    for (const key of ["Space", "ArrowUp", "ArrowUp", "Space"]) {
      await admin.keyboard.press(key);
      await admin.waitForTimeout(250); // laisse dnd-kit mesurer et animer chaque déplacement
    }
    await expect(entries.nth(0)).toContainText("Chaimae Chraibi");

    // Persisté côté serveur.
    await admin.reload();
    await expect(admin.getByTestId("admin-machine-3").getByTestId("admin-queue-entry").nth(0)).toContainText(
      "Chaimae Chraibi",
    );
    const chaimae = await phone(browser, "E2E-003");
    await expect(chaimae.getByTestId("my-position")).toHaveText("1");
  });

  test("comptes : création, suspension (déconnexion immédiate), réactivation", async ({ browser }) => {
    const student = await phone(browser, "E2E-002");
    const admin = await phone(browser, "admin-e2e", "/admin/comptes");
    await admin.locator('input[name="schoolId"]').fill("E2E-CREE");
    await admin.locator('input[name="firstName"]').fill("Yasmine");
    await admin.locator('input[name="lastName"]').fill("Zahiri");
    await admin.getByRole("button", { name: "Créer", exact: true }).click();
    await expect(admin.getByTestId("temp-password")).toContainText(
      "Mot de passe temporaire de Yasmine Zahiri",
    );

    const row = admin.getByTestId("account-row").filter({ hasText: "E2E-002" });
    await row.getByRole("button", { name: "Suspendre" }).click();
    await row.getByRole("button", { name: "Confirmer la suspension" }).click();
    await expect(row).toContainText("Suspendu");
    await nudge(student);
    await expect(student).toHaveURL(/\/connexion$/);

    await row.getByRole("button", { name: "Réactiver" }).click();
    await expect(row).toContainText("Actif");
  });
});
