import { describe, expect, it } from "vitest";
import { hourlyAverages, spotChunks } from "@/domain/spot";

// Prix spot energy-charts.info (T58) : pas horaire jusqu'en septembre 2025, quart-horaire
// ensuite ; WattsUp garde la moyenne de chaque heure UTC.

const H = 3600;

describe("hourlyAverages", () => {
  it("garde les heures déjà horaires", () => {
    expect(hourlyAverages({ unix_seconds: [1704063600, 1704067200], price: [0.1, 41.67] })).toEqual(
      [
        { start: new Date(1704063600 * 1000), eurMwh: 0.1 },
        { start: new Date(1704067200 * 1000), eurMwh: 41.67 },
      ],
    );
  });

  it("moyenne les quarts d'heure, sans les valeurs absentes", () => {
    const t = 1791756000; // 12 oct. 2026 00:00 Paris
    const r = hourlyAverages({
      unix_seconds: [t, t + 900, t + 1800, t + 2700, t + H, t + H + 900],
      price: [100, 110, null, 120, -5, 5],
    });
    expect(r).toEqual([
      { start: new Date(t * 1000), eurMwh: 110 },
      { start: new Date((t + H) * 1000), eurMwh: 0 },
    ]);
  });

  it("refuse une réponse inattendue", () => {
    expect(() => hourlyAverages({ price: [] })).toThrow(/inattendue/);
    expect(() => hourlyAverages({ unix_seconds: [1], price: [1, 2] })).toThrow(/inattendue/);
  });
});

describe("spotChunks", () => {
  it("découpe une période par semestres (fin incluse)", () => {
    expect(spotChunks("2023-01-01", "2024-02-10")).toEqual([
      ["2023-01-01", "2023-06-30"],
      ["2023-07-01", "2023-12-31"],
      ["2024-01-01", "2024-02-10"],
    ]);
    expect(spotChunks("2026-10-11", "2026-10-13")).toEqual([["2026-10-11", "2026-10-13"]]);
  });

  it("ou par mois", () => {
    expect(spotChunks("2026-01-20", "2026-03-05", 1)).toEqual([
      ["2026-01-20", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-05"],
    ]);
    expect(spotChunks("2026-03-06", "2026-03-05", 1)).toEqual([]);
  });
});
