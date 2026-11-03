import { expect, test } from "@playwright/test";
import { open } from "./helpers";

// Compte neuf → parcours de bienvenue → token copié → premier envoi → tableau de bord alimenté.
// Sans la session du compte de démo.
test.use({ storageState: { cookies: [], origins: [] } });
test("compte neuf : bienvenue, token copié, premier envoi, tableau de bord alimenté", async ({
  page,
  context,
  request,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const email = `e2e-${info.project.name}-${Date.now()}@wattsup.test`;

  await open(page, "/inscription");
  await page.getByLabel("Prénom").fill("Camille");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill("motdepasse-e2e-neuf");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/bienvenue/);
  await expect(page.getByText("Étape 1 sur 5")).toBeVisible();
  await page.waitForLoadState("networkidle");

  // 1. Profil : un module basculé, son état est enregistré.
  const wood = page.getByRole("switch", { name: /Bois/ });
  const before = await wood.getAttribute("aria-checked");
  await wood.click();
  await expect(wood).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  await page.getByRole("button", { name: "Suivant" }).click();

  // 2. Commune : passée (aucun appel sortant pendant les tests).
  await expect(page.getByText("Étape 2 sur 5")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Suivant" }).click();

  // 3. Contrat actuel : offre HP/HC de référence, souscrite.
  await expect(page.getByText("Étape 3 sur 5")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Ajouter un contrat" }).click();
  await page
    .getByRole("button", { name: /Heures creuses/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("heading", { name: "Contrat en cours" })).toBeVisible();
  await page.getByRole("button", { name: "Suivant" }).click();

  // 4. Home Assistant : token généré, copié, utilisé pour deux envois horaires.
  await expect(page.getByText("Étape 4 sur 5")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Générer un token" }).click();
  const tokenBox = page.locator("div.font-mono").filter({ hasText: /^wu_/ });
  await expect(tokenBox).toBeVisible();
  const shown = (await tokenBox.textContent())?.trim() ?? "";
  await page.getByRole("button", { name: "Copier" }).nth(1).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(shown);

  const now = Date.now();
  for (const [i, kwh] of [
    [2, 100],
    [1, 100.6],
  ] as const) {
    const res = await request.post("/api/v1/ingest", {
      headers: { authorization: `Bearer ${copied}` },
      data: {
        version: 1,
        ts: new Date(now - i * 3_600_000).toISOString(),
        energy: { grid_import_kwh: kwh },
      },
    });
    expect(res.status()).toBe(200);
  }
  await expect(page.getByText("Premier envoi reçu")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Suivant" }).click();

  // 5. Historique : facultatif, on termine.
  await expect(page.getByText("Étape 5 sur 5")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Terminer" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("region", { name: /^Budget ·/ })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Votre consommation|Quand vous consommez|D'où vient votre électricité/,
    }),
  ).toBeVisible();
});
