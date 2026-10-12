import { describe, expect, it } from "vitest";
import { priceIntervals } from "@/domain/tariff/engine";
import { spotKwhPrice } from "@/domain/tariff/spot";
import type { PriceableInterval, PricingContext, SpotContract } from "@/domain/tariff/types";

// Contrat au prix spot (T58) : prix du kWh de chaque heure = (min(spot + acheminement +
// accise, plafond) + frais) × (1 + TVA), saison d'hiver de novembre à mars. Montants
// attendus calculés à la main.

const TZ = "Europe/Paris";
const socap: SpotContract = {
  kind: "spot",
  subscriptionEurYear: 0,
  formula: {
    network: { winter: 0.0632, summer: 0.0149 },
    excise: 0.03085,
    cap: { winter: 0.25, summer: 0.1417 },
    fees: 0.025,
    vat: 0.2,
  },
};

describe("prix du kWh", () => {
  it("été : spot + acheminement + accise, frais, TVA", () => {
    // 80 €/MWh = 0,08 € ; (0,08 + 0,0149 + 0,03085 + 0,025) × 1,2 = 0,18090
    expect(spotKwhPrice(socap.formula, 80, 7)).toBeCloseTo(0.1809, 6);
  });

  it("le plafond s'applique avant les frais", () => {
    // (min(0,3 + 0,0149 + 0,03085 ; 0,1417) + 0,025) × 1,2 = 0,20004
    expect(spotKwhPrice(socap.formula, 300, 7)).toBeCloseTo(0.20004, 6);
    // Hiver : plafond 0,25 ; (0,25 + 0,025) × 1,2 = 0,33
    expect(spotKwhPrice(socap.formula, 300, 1)).toBeCloseTo(0.33, 6);
  });

  it("prix négatif : le kWh peut descendre sous les frais", () => {
    // (−0,05 + 0,0149 + 0,03085 + 0,025) × 1,2 = 0,02490
    expect(spotKwhPrice(socap.formula, -50, 7)).toBeCloseTo(0.0249, 6);
  });

  it("sans plafond", () => {
    const uncapped = { ...socap.formula, cap: null };
    expect(spotKwhPrice(uncapped, 300, 7)).toBeCloseTo((0.3 + 0.0149 + 0.03085 + 0.025) * 1.2, 6);
  });
});

describe("moteur", () => {
  // Deux heures d'été : 14 h et 15 h le 15 juillet 2026 (UTC+2).
  const two: PriceableInterval[] = [
    { granularity: "hour", start: new Date("2026-07-15T12:00:00Z"), kwh: 1 },
    { granularity: "hour", start: new Date("2026-07-15T13:00:00Z"), kwh: 2 },
  ];
  const spot = new Map([
    ["2026-07-15T12:00:00.000Z", 80],
    ["2026-07-15T13:00:00.000Z", -50],
  ]);
  const ctx = (prices: Map<string, number>, fallback?: number): PricingContext => ({
    timezone: TZ,
    period: { from: "2026-07-15", to: "2026-07-15" },
    spotPrice: (start) => prices.get(start.toISOString()),
    spotFallback: fallback,
  });

  it("chaque heure à son prix spot", () => {
    const r = priceIntervals(two, socap, ctx(spot));
    expect(r.bySlot.spot?.kwh).toBe(3);
    expect(r.energyCents).toBe(Math.round((0.1809 + 2 * 0.0249) * 100));
    expect(r.assumedSpotHours).toBe(0);
  });

  it("heure sans prix spot : prix moyen de la période, comptée", () => {
    const r = priceIntervals(two, socap, ctx(new Map([["2026-07-15T12:00:00.000Z", 80]]), 80));
    expect(r.energyCents).toBe(Math.round(3 * 0.1809 * 100));
    expect(r.assumedSpotHours).toBe(1);
  });

  it("total journalier : prix moyen des heures du jour, approximatif", () => {
    const day = new Map<string, number>();
    for (let h = 0; h < 24; h++) day.set(new Date(Date.UTC(2026, 6, 14, 22 + h)).toISOString(), 80);
    const r = priceIntervals(
      [{ granularity: "day", date: "2026-07-15", slot: null, kwh: 10 }],
      socap,
      ctx(day),
    );
    expect(r.energyCents).toBe(Math.round(10 * 0.1809 * 100));
    expect(r.approximatedKwh).toBe(10);
  });
});
