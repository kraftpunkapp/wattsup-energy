import { describe, expect, it } from "vitest";
import { bestWindow, marginalCosts, type Appliance } from "@/domain/forecast/windows";

// Coût d'un kWh de plus et meilleur créneau par appareil (T70, SPEC §7.14). Le surplus prévu
// (après la batterie) est consommé d'abord, au prix de revente perdu ; le reste au prix du
// contrat. Novembre, UTC+1 ; départs au quart d'heure.

const TZ = "Europe/Paris";
const HOUR = 3_600_000;
const local = (date: string, h: number, m = 0) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (h - 1) * HOUR + m * 60_000);

/** Demain : HC 0,20 € de 22 h à 6 h, HP 0,27 € ; surplus de 2 kWh/h de 12 h à 14 h. */
function tomorrow(surplus: (h: number) => number = (h) => (h >= 12 && h < 14 ? 2 : 0)) {
  return Array.from({ length: 24 }, (_, h) => ({
    start: local("2026-11-22", h),
    priceEurKwh: h >= 22 || h < 6 ? 0.2 : 0.27,
    surplusKwh: surplus(h),
  }));
}
const washer: Appliance = {
  id: "w",
  name: "Lave-linge",
  powerKw: 2,
  durationMin: 120,
  allowedFrom: 8,
  allowedTo: 22,
};
const car: Appliance = {
  id: "c",
  name: "Véhicule",
  powerKw: 3.7,
  durationMin: 240,
  allowedFrom: 0,
  allowedTo: 0,
};

describe("bestWindow", () => {
  it("le surplus solaire d'abord : lave-linge de 12 h à 14 h, gratuit sans revente", () => {
    const w = bestWindow(tomorrow(), washer, TZ, local("2026-11-22", 0), 0);
    expect(w).toMatchObject({ start: local("2026-11-22", 12), end: local("2026-11-22", 14) });
    expect(w?.costEur).toBeCloseTo(0, 9);
    expect(w?.solarShare).toBeCloseTo(1, 9);
    // Lancé tout de suite (8 h, première heure permise) : 4 kWh en HP.
    expect(w?.nowCostEur).toBeCloseTo(4 * 0.27, 9);
  });

  it("avec revente : le surplus coûte le prix de revente perdu", () => {
    const w = bestWindow(tomorrow(), washer, TZ, local("2026-11-22", 0), 0.1);
    expect(w?.costEur).toBeCloseTo(4 * 0.1, 9);
  });

  it("surplus partiel : la part manquante au prix de l'heure", () => {
    const hours = tomorrow((h) => (h === 12 ? 1 : 0));
    const oneHour = { ...washer, durationMin: 60 };
    const w = bestWindow(hours, oneHour, TZ, local("2026-11-22", 0), 0);
    expect(w?.start).toEqual(local("2026-11-22", 12));
    expect(w?.costEur).toBeCloseTo(1 * 0.27, 9);
    expect(w?.solarShare).toBeCloseTo(0.5, 9);
  });

  it("véhicule sans contrainte d'heure : les heures creuses, le plus tôt à égalité", () => {
    const w = bestWindow(
      tomorrow(() => 0),
      car,
      TZ,
      local("2026-11-22", 0),
      0,
    );
    expect(w?.start).toEqual(local("2026-11-22", 0));
    expect(w?.costEur).toBeCloseTo(3.7 * 4 * 0.2, 9);
  });

  it("plage qui passe minuit (22 h – 6 h) et départ au quart d'heure après maintenant", () => {
    const night = { ...washer, durationMin: 60, allowedFrom: 22, allowedTo: 6 };
    const w = bestWindow(
      tomorrow(() => 0),
      night,
      TZ,
      local("2026-11-22", 3, 10),
      0,
    );
    expect(w?.start).toEqual(local("2026-11-22", 3, 15));
    expect(w?.end).toEqual(local("2026-11-22", 4, 15));
  });

  it("aucun départ possible dans l'horizon : null", () => {
    const long = { ...washer, durationMin: 25 * 60 };
    expect(bestWindow(tomorrow(), long, TZ, local("2026-11-22", 0), 0)).toBeNull();
  });
});

describe("marginalCosts", () => {
  it("surplus après la batterie et prix de chaque heure ; coût d'un kWh de plus", () => {
    const r = marginalCosts(
      [
        { start: local("2026-11-22", 12), exportKwh: 0.5 },
        { start: local("2026-11-22", 20), exportKwh: 0 },
      ],
      [0.27, 0.27],
      0.1,
    );
    expect(r).toEqual([
      {
        start: local("2026-11-22", 12),
        priceEurKwh: 0.27,
        surplusKwh: 0.5,
        kwhCostEur: 0.5 * 0.1 + 0.5 * 0.27,
      },
      { start: local("2026-11-22", 20), priceEurKwh: 0.27, surplusKwh: 0, kwhCostEur: 0.27 },
    ]);
  });
});
