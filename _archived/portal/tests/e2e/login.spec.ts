import { expect, test } from "@playwright/test";

test("affiche l'ecran de connexion quand aucune session n'est active", async ({ page }) => {
  await page.route("**/api/web/session/get_session_info", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { uid: false } }),
    });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Resto Pilot" })).toBeVisible();
  await expect(page.getByLabel("Identifiant")).toBeVisible();
  await expect(page.getByLabel("Mot de passe")).toBeVisible();
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
});
