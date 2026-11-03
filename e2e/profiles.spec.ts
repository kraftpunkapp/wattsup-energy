import { expect, test } from "@playwright/test";
import { ALL_ON, expectNoHorizontalScroll, open, setDemoProfile, type Profile } from "./helpers";

// Aucune trace d'un module désactivé (SPEC §7.6), sur 5 profils et 2 largeurs d'écran.
const PROFILES: { name: string; profile: Profile }[] = [
  { name: "tout activé", profile: ALL_ON },
  {
    name: "granulés seuls",
    profile: { ...ALL_ON, solar: false, battery: false, wood: false, electricHeating: false },
  },
  {
    name: "bois seul",
    profile: { ...ALL_ON, solar: false, battery: false, pellet: false, electricHeating: false },
  },
  {
    name: "solaire et batterie",
    profile: { ...ALL_ON, pellet: false, wood: false, electricHeating: false },
  },
  {
    name: "réseau seul",
    profile: { solar: false, battery: false, pellet: false, wood: false, electricHeating: false },
  },
];

/** Textes propres à chaque module, cherchés hors Réglages (le profil y liste tout). */
const MARKERS: Record<keyof Profile, { path: string; text: RegExp }[]> = {
  solar: [
    { path: "/", text: /Production solaire|Production et ensoleillement/ },
    { path: "/rentabilite", text: /Installation solaire/ },
  ],
  battery: [
    { path: "/", text: /La batterie ne produit rien/ },
    { path: "/rentabilite", text: /Batterie ·/ },
  ],
  pellet: [{ path: "/chauffage", text: /Granulés/ }],
  wood: [{ path: "/chauffage", text: /\bBois\b/ }],
  electricHeating: [
    { path: "/chauffage", text: /Électricité de chauffage/ },
    { path: "/", text: /Chauffage électrique/ },
  ],
};

test.describe.configure({ mode: "serial" });

for (const { name, profile } of PROFILES) {
  test(`profil « ${name} »`, async ({ page }) => {
    await setDemoProfile(profile);
    await open(page, "/");
    const heating = profile.pellet || profile.wood || profile.electricHeating;
    const roi = profile.solar || profile.battery;

    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: /Chauffage/ })).toHaveCount(heating ? 1 : 0);
    await expect(nav.getByRole("link", { name: /Rentabilité|ROI/ })).toHaveCount(roi ? 1 : 0);

    const pages = [
      "/",
      "/contrats",
      ...(heating ? ["/chauffage"] : []),
      ...(roi ? ["/rentabilite"] : []),
    ];
    for (const path of pages) {
      await open(page, path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectNoHorizontalScroll(page);
      const text = (await page.locator("main").innerText()) ?? "";
      for (const [module, markers] of Object.entries(MARKERS) as [
        keyof Profile,
        typeof MARKERS.solar,
      ][]) {
        if (profile[module]) continue;
        for (const m of markers.filter((x) => x.path === path)) {
          expect(text, `${module} masqué sur ${path}`).not.toMatch(m.text);
        }
      }
    }
    // Module masqué : la route redirige vers la vue d'ensemble.
    if (!heating) {
      await open(page, "/chauffage");
      await expect(page).toHaveURL(/\/$/);
    }
  });
}

test.afterAll(async () => {
  await setDemoProfile(ALL_ON);
});
