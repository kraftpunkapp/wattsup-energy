import { describe, expect, it } from "vitest";
import {
  activeProfileLabels,
  NAV_ITEMS,
  parseProfile,
  visibleModules,
  type EnergyProfile,
} from "@/domain/profile";

const none: EnergyProfile = {
  solar: false,
  battery: false,
  pellet: false,
  wood: false,
  electricHeating: false,
};
const all: EnergyProfile = {
  solar: true,
  battery: true,
  pellet: true,
  wood: true,
  electricHeating: true,
};
const navIds = (p: EnergyProfile) => visibleModules(p).nav.map((n) => n.id);

describe("visibleModules (SPEC §7.6)", () => {
  it("profil complet : tous les onglets (Prévisions hors barre mobile) et tous les blocs", () => {
    const v = visibleModules(all);
    expect(navIds(all)).toEqual(["overview", "forecast", "heating", "roi", "contracts", "settings"]);
    // Barre d'onglets mobile : 5 entrées au plus, Prévisions passe par la carte « Demain ».
    expect(visibleModules(all).nav.filter((n) => n.mobile !== false)).toHaveLength(5);
    expect(v.refillForecast).toBe(true);
    expect(v.fuelTabs).toBe(true);
    expect(v.heatingCategories).toBe(true);
  });

  it("profil vide : ni Chauffage ni Rentabilité", () => {
    expect(navIds(none)).toEqual(["overview", "forecast", "contracts", "settings"]);
    const v = visibleModules(none);
    expect(v.refillForecast).toBe(false);
    expect(v.solar || v.battery || v.pellet || v.wood).toBe(false);
  });

  it.each([
    ["granulés seuls", { pellet: true }],
    ["bois seul", { wood: true }],
    ["chauffage électrique seul", { electricHeating: true }],
  ])("Chauffage visible avec %s", (_label, patch) => {
    expect(navIds({ ...none, ...patch })).toContain("heating");
  });

  it("chauffage électrique seul : pas d'encart de prévision", () => {
    expect(visibleModules({ ...none, electricHeating: true }).refillForecast).toBe(false);
  });

  it("onglets Granulés / Bois seulement si les deux sont actifs", () => {
    expect(visibleModules({ ...none, pellet: true }).fuelTabs).toBe(false);
    expect(visibleModules({ ...none, pellet: true, wood: true }).fuelTabs).toBe(true);
  });

  it.each([
    ["solaire seul", { solar: true }],
    ["batterie seule", { battery: true }],
  ])("Rentabilité visible avec %s", (_label, patch) => {
    expect(navIds({ ...none, ...patch })).toContain("roi");
  });

  it("catégories chauffage masquées si le chauffage électrique est désactivé", () => {
    expect(visibleModules({ ...all, electricHeating: false }).heatingCategories).toBe(false);
  });
});

describe("routes", () => {
  it("chaque onglet a une route unique", () => {
    const hrefs = NAV_ITEMS.map((n) => n.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("isRouteVisible : /rentabilite masquée sans solaire ni batterie", () => {
    const v = visibleModules(none);
    expect(v.isRouteVisible("/rentabilite")).toBe(false);
    expect(v.isRouteVisible("/contrats")).toBe(true);
    expect(v.isRouteVisible("/chauffage/sous-page")).toBe(false);
  });
});

describe("parseProfile", () => {
  it("accepte un profil complet et ignore les clés en trop", () => {
    expect(parseProfile({ ...all, extra: 1 })).toEqual(all);
  });

  it.each([null, "x", { ...all, wood: "oui" }, { solar: true }])("rejette %j", (input) => {
    expect(parseProfile(input)).toBeNull();
  });
});

describe("activeProfileLabels", () => {
  it("profils activés, dans l'ordre fixe", () => {
    expect(
      activeProfileLabels({
        solar: true,
        battery: false,
        pellet: true,
        wood: false,
        electricHeating: true,
      }),
    ).toEqual(["Solaire", "Granulés", "Chauffage électrique"]);
    expect(
      activeProfileLabels({
        solar: false,
        battery: false,
        pellet: false,
        wood: false,
        electricHeating: false,
      }),
    ).toEqual([]);
  });
});
