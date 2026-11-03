import { expect, test } from "@playwright/test";
import { open } from "./helpers";

// Changement de période et de page : retour visuel immédiat (lien actif qui pulse, contenu
// estompé), puis la nouvelle page s'affiche sans rester bloquée. Sans le contournement
// useNavigationWake, React 19.2 laissait parfois la navigation en attente jusqu'au rendu
// suivant (jusqu'à 60 s).

const busy = (page: import("@playwright/test").Page) => page.locator("main [aria-busy]");

test("Vue d'ensemble : Mois ↔ Année plusieurs fois, retour immédiat et affichage rapide", async ({
  page,
}) => {
  await open(page, "/?p=2026-09");
  for (const [target, other, url] of [
    ["Année", "Mois", /\?p=\d{4}$/],
    ["Mois", "Année", /\?p=\d{4}-\d{2}$/],
    ["Année", "Mois", /\?p=\d{4}$/],
    ["Mois", "Année", /\?p=\d{4}-\d{2}$/],
  ] as const) {
    const tab = page.getByRole("tab", { name: target });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    await expect(page.getByRole("tab", { name: other })).toHaveAttribute("aria-selected", "false");
    await expect(page).toHaveURL(url, { timeout: 10_000 });
    await expect(busy(page)).toHaveAttribute("aria-busy", "false", { timeout: 10_000 });
  }
});

test("Chauffage : flèche de saison, affichage rapide", async ({ page }) => {
  await open(page, "/chauffage");
  const previous = page.getByRole("link", { name: "Saison précédente" });
  await previous.click();
  await expect(page).toHaveURL(/\?s=\d{4}$/, { timeout: 10_000 });
  await expect(busy(page)).toHaveAttribute("aria-busy", "false", { timeout: 10_000 });
});

test("Menu : les pages s'affichent sans rester bloquées", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "menu latéral : bureau seulement");
  await open(page, "/");
  for (const [name, path, heading] of [
    ["Chauffage", "/chauffage", "Chauffage"],
    ["Contrats", "/contrats", "Contrats"],
    ["Accueil", "/", "Vue d'ensemble"],
  ] as const) {
    await page
      .getByRole("navigation", { name: "Navigation principale" })
      .getByRole("link", { name })
      .click();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/$" : path}`), { timeout: 10_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading, { timeout: 10_000 });
  }
});
