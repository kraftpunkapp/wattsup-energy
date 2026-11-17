import { describe, expect, it } from "vitest";
import {
  currentStock,
  isUnitFor,
  lastPurchasePrice,
  seasonConsumption,
  toBaseQty,
  referencePrice,
  type FuelEvent,
} from "@/domain/heating/fuel";

const settings = { pelletBagKg: 15, pelletBagsPerPallet: 66 };

const ev = (
  at: string,
  type: FuelEvent["type"],
  qty: number,
  unit: FuelEvent["unit"] = "bag",
  priceEur: number | null = null,
  fuel: FuelEvent["fuel"] = "pellet",
): FuelEvent => ({ fuel, type, at: new Date(at), qty, unit, priceEur });

describe("toBaseQty", () => {
  it("granulés en kg (sac et palette selon les réglages), bois en stères", () => {
    expect(toBaseQty({ fuel: "pellet", qty: 2, unit: "bag" }, settings)).toBe(30);
    expect(toBaseQty({ fuel: "pellet", qty: 1, unit: "pallet" }, settings)).toBe(990);
    expect(toBaseQty({ fuel: "pellet", qty: 12.5, unit: "kg" }, settings)).toBe(12.5);
    expect(toBaseQty({ fuel: "wood", qty: 0.5, unit: "stere" }, settings)).toBe(0.5);
  });

  it("unités saisissables par combustible", () => {
    expect(isUnitFor("pellet", "pallet")).toBe(true);
    expect(isUnitFor("wood", "bag")).toBe(false);
  });

  it("refuse une unité incohérente avec le combustible", () => {
    expect(() => toBaseQty({ fuel: "wood", qty: 1, unit: "bag" }, settings)).toThrow(/unité/);
    expect(() => toBaseQty({ fuel: "pellet", qty: 1, unit: "stere" }, settings)).toThrow(/unité/);
  });
});

describe("currentStock", () => {
  const events = [
    ev("2025-09-01T10:00:00Z", "purchase", 1, "pallet", 420),
    ev("2025-10-20T19:00:00Z", "consumption", 1),
    ev("2025-10-21T19:00:00Z", "consumption", 1),
    ev("2025-11-01T09:00:00Z", "stock_snapshot", 50),
    ev("2025-11-02T19:00:00Z", "consumption", 2),
    ev("2025-11-05T12:00:00Z", "purchase", 10, "bag", 70),
    ev("2025-11-05T12:00:00Z", "consumption", 1, "bag", null, "wood"),
  ];

  it("sans relevé : achats moins consommations depuis zéro", () => {
    expect(currentStock(events, "pellet", new Date("2025-10-31T00:00:00Z"), settings)).toBe(
      990 - 30,
    );
  });

  it("le dernier relevé fait foi, puis achats et consommations postérieurs", () => {
    expect(currentStock(events, "pellet", new Date("2025-12-01T00:00:00Z"), settings)).toBe(
      (50 - 2 + 10) * 15,
    );
  });

  it("ignore les événements futurs et l'autre combustible", () => {
    expect(currentStock(events, "pellet", new Date("2025-08-01T00:00:00Z"), settings)).toBe(0);
    expect(currentStock([], "wood", new Date(), settings)).toBe(0);
  });
});

describe("seasonConsumption", () => {
  const season = { from: new Date("2025-10-01T00:00:00Z"), to: new Date("2026-05-01T00:00:00Z") };

  it("consommations saisies en priorité", () => {
    const events = [
      ev("2025-10-20T19:00:00Z", "consumption", 1),
      ev("2025-12-20T19:00:00Z", "consumption", 3),
      ev("2026-06-01T19:00:00Z", "consumption", 9), // hors saison
      ev("2025-11-01T09:00:00Z", "stock_snapshot", 50),
    ];
    expect(seasonConsumption(events, "pellet", season, settings)).toEqual({
      qty: 60,
      method: "events",
    });
  });

  it("sinon écarts entre relevés, corrigés des achats", () => {
    const events = [
      ev("2025-10-01T09:00:00Z", "stock_snapshot", 60),
      ev("2025-12-15T09:00:00Z", "purchase", 30, "bag", 210),
      ev("2026-01-10T09:00:00Z", "stock_snapshot", 40),
      ev("2026-04-30T09:00:00Z", "stock_snapshot", 10),
    ];
    // (60 + 30 − 40) + (40 − 10) = 80 sacs
    expect(seasonConsumption(events, "pellet", season, settings)).toEqual({
      qty: 80 * 15,
      method: "snapshots",
    });
  });

  it("rien d'exploitable : aucune méthode", () => {
    expect(
      seasonConsumption(
        [ev("2025-11-01T09:00:00Z", "stock_snapshot", 50)],
        "pellet",
        season,
        settings,
      ),
    ).toEqual({ qty: 0, method: "none" });
  });
});

describe("prix", () => {
  const purchases = [
    ev("2024-09-01T10:00:00Z", "purchase", 1, "pallet", 396),
    ev("2025-09-01T10:00:00Z", "purchase", 10, "bag", 75),
    ev("2025-10-01T10:00:00Z", "purchase", 5, "bag", null), // prix inconnu : ignoré
    ev("2025-10-02T10:00:00Z", "consumption", 1),
  ];

  it("prix de référence : moyenne pondérée des achats des 12 mois précédents", () => {
    // Fin août 2025 : seul l'achat de septembre 2024.
    expect(referencePrice(purchases, "pellet", settings, new Date("2025-08-31T00:00:00Z"))).toEqual(
      { perUnit: 396 / 990, basis: "recent" },
    );
    // Un an jour pour jour après, l'achat de 2024 sort de la fenêtre.
    expect(
      referencePrice(purchases, "pellet", settings, new Date("2025-09-01T10:00:00Z"))?.perUnit,
    ).toBeCloseTo(75 / 150, 9);
    // Les deux dans la fenêtre : pondéré par la quantité.
    expect(
      referencePrice(
        [...purchases, ev("2025-03-01T10:00:00Z", "purchase", 20, "bag", 140)],
        "pellet",
        settings,
        new Date("2025-08-31T00:00:00Z"),
      )?.perUnit,
    ).toBeCloseTo((396 + 140) / (990 + 300), 9);
    // Au 1er mars 2026, seul l'achat de septembre 2025 compte : l'ancien prix est écarté.
    expect(
      referencePrice(purchases, "pellet", settings, new Date("2026-03-01T00:00:00Z"))?.perUnit,
    ).toBeCloseTo(75 / 150, 9);
    expect(
      referencePrice(purchases, "wood", settings, new Date("2026-03-01T00:00:00Z")),
    ).toBeNull();
  });

  it("sans achat dans les 12 mois : le dernier achat chiffré avant, sinon le premier après", () => {
    expect(referencePrice(purchases, "pellet", settings, new Date("2027-06-01T00:00:00Z"))).toEqual(
      { perUnit: 75 / 150, basis: "last", purchasedAt: new Date("2025-09-01T10:00:00Z") },
    );
    expect(referencePrice(purchases, "pellet", settings, new Date("2024-01-01T00:00:00Z"))).toEqual(
      { perUnit: 396 / 990, basis: "next", purchasedAt: new Date("2024-09-01T10:00:00Z") },
    );
  });

  it("dernier prix d'achat connu, par unité de base", () => {
    expect(lastPurchasePrice(purchases, "pellet", settings)).toBeCloseTo(75 / 150, 9);
    expect(lastPurchasePrice([], "pellet", settings)).toBeNull();
  });

  it("un lot gratuit (0 €) ne sert pas de base à la prévision", () => {
    const wood = (at: string, qty: number, priceEur: number) =>
      ev(at, "purchase", qty, "stere", priceEur, "wood");
    const events = [wood("2025-09-01T10:00:00Z", 4, 320), wood("2025-11-01T10:00:00Z", 3, 0)];
    expect(lastPurchasePrice(events, "wood", settings)).toBeCloseTo(80, 9);
    expect(lastPurchasePrice(events.slice(1), "wood", settings)).toBeNull();
    // mais il compte dans le coût réel de la saison : (320 + 0) / 7 stères
    expect(
      referencePrice(events, "wood", settings, new Date("2025-12-01T00:00:00Z"))?.perUnit,
    ).toBeCloseTo(320 / 7, 9);
  });
});
