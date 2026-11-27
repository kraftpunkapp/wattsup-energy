import { expect, test } from "@playwright/test";
import { ALL_ON, expectNoHorizontalScroll, open, setDemoProfile } from "./helpers";

// Parcours du PRD (§ « Parcours utilisateurs ») sur le foyer de démo.
test.describe.configure({ mode: "serial" });
test.beforeEach(async () => {
  await setDemoProfile(ALL_ON);
});

test("parcours 1 : le profil énergétique masque le bois dans tout le chauffage", async ({
  page,
}) => {
  await open(page, "/reglages?onglet=profil");
  const wood = page.getByRole("switch", { name: /Bois/ });
  await wood.click();
  await expect(wood).toHaveAttribute("aria-checked", "false");
  await open(page, "/chauffage");
  // Le bois n'est plus suivi : ni carte, ni chiffres ; seule l'invitation à le suivre reste.
  await expect(page.getByRole("heading", { name: "Bois", exact: true })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/Bois brûlé|stères?/);
  await expect(page.getByRole("region", { name: "Suivre le bois" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Granulés");
});

test("parcours 2 : 12 sacs en réserve → prévision de l'hiver prochain en palettes", async ({
  page,
}) => {
  await open(page, "/chauffage");
  const pellets = page.locator("section", { has: page.getByRole("heading", { name: "Granulés" }) });
  await pellets.getByRole("button", { name: "Corriger le stock" }).click();
  await pellets.getByLabel("sacs restants").fill("12");
  await pellets.getByRole("button", { name: "Enregistrer le relevé" }).click();
  // Sans rechargement : l'écran doit suivre l'enregistrement (voir `FetchWake`).
  await expect(pellets.getByText("12", { exact: true }).first()).toBeVisible();

  const forecast = page.locator("section", {
    has: page.getByRole("heading", { name: "Réapprovisionnement · le détail" }),
  });
  // Saison prochaine : le type d'hiver se choisit, la quantité à prévoir suit.
  await expect(forecast.getByText(/Prévoyez [\d\s\u202f]+ sacs? de granulés/)).toBeVisible();
  await forecast.getByRole("button", { name: "rigoureux" }).click();
  await expect(forecast.getByRole("button", { name: "rigoureux" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(forecast.getByText(/Prévoyez [\d\s\u202f]+ sacs? de granulés/)).toBeVisible();
});

test("parcours 3 : rentabilité solaire et batterie, mise à jour du coût", async ({
  page,
}, info) => {
  await open(page, "/rentabilite");
  const solar = page.locator("section", { has: page.getByRole("heading", { name: /Panneaux/ }) });
  await expect(solar.getByRole("img", { name: /amortis/ })).toBeVisible();
  await expect(solar.getByText(/Économies sur/)).toBeVisible();
  const before = await solar.getByRole("img", { name: /amortis/ }).getAttribute("aria-label");

  await solar.getByRole("button", { name: /Modifier « Panneaux/ }).click();
  // Une valeur par taille d'écran : chaque passage modifie bien le coût.
  await solar.getByLabel("Coût TTC (€)").fill(info.project.name === "mobile" ? "4800" : "3200");
  await solar.getByRole("button", { name: "Enregistrer" }).click();
  await expect(solar.getByRole("img", { name: /amortis/ })).not.toHaveAttribute(
    "aria-label",
    before ?? "",
  );

  const battery = page.locator("section", { has: page.getByRole("heading", { name: /Batterie/ }) });
  await battery.getByText("D'où viennent ces économies").click();
  await expect(battery.getByText(/Électricité évitée \(décharge\)/)).toBeVisible();
});

test("heures creuses d'été : saisie, deux frises, puis retour à une seule", async ({
  page,
}, info) => {
  const name = `Été ${info.project.name}`;
  await open(page, "/contrats");
  await page.getByRole("button", { name: "Ajouter un contrat" }).click();
  await page.getByRole("button", { name: /^Heures creuses/ }).click();
  await page.getByLabel("Nom", { exact: true }).fill(name);
  await page.getByRole("checkbox", { name: "Horaires différents en été" }).check();
  await expect(page.getByText("Heures creuses d'hiver (nov. – mars)")).toBeVisible();
  await expect(page.getByText("Heures creuses d'été (avr. – oct.)")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();

  const others = page.getByText(/Gérer mes autres contrats/);
  const card = page.locator("li", { has: page.getByRole("heading", { name }) });
  await others.click();
  await expect(card.getByRole("heading", { name: "Hiver (nov. – mars)" })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Été (avr. – oct.)" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await card.getByRole("button", { name: "Modifier les prix" }).click();
  await page.getByRole("checkbox", { name: "Horaires différents en été" }).uncheck();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(others).toBeVisible();
  if (!(await card.isVisible())) await others.click();
  await expect(card.getByRole("img", { name: /^Heures creuses de/ })).toHaveCount(1);
  await expect(card.getByRole("heading", { name: "Été (avr. – oct.)" })).toHaveCount(0);

  // Le foyer de démo retrouve ses seuls contrats.
  await card.getByRole("button", { name: `Supprimer « ${name} »` }).click();
  await page.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(card).toHaveCount(0);
});
