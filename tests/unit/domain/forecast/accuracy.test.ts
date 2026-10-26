import { describe, expect, it } from "vitest";
import { compareForecast } from "@/domain/forecast/accuracy";

// Prévu contre réel (T73, SPEC §7.14) : par jour, production et consommation prévues la
// veille au soir face aux mesures ; écart moyen sur 7 jours (somme des écarts ÷ somme du
// réel). Novembre, UTC+1.

const TZ = "Europe/Paris";
const HOUR = 3_600_000;
const local = (date: string, h: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (h - 1) * HOUR);
const day = (date: string, kwh: number) =>
  Array.from({ length: 24 }, (_, h) => ({ start: local(date, h), kwh }));

describe("compareForecast", () => {
  it("par jour : prévu et mesuré ; écart moyen pondéré par le réel", () => {
    const forecast = [
      ...day("2026-11-20", 0).map((x, h) => ({
        start: x.start,
        solarKwh: h === 12 ? 10 : 0,
        loadKwh: 0.5,
      })),
      ...day("2026-11-21", 0).map((x, h) => ({
        start: x.start,
        solarKwh: h === 12 ? 4 : 0,
        loadKwh: 1,
      })),
    ];
    const r = compareForecast({
      forecast,
      solar: [
        { start: local("2026-11-20", 12), kwh: 8 },
        { start: local("2026-11-21", 12), kwh: 5 },
      ],
      load: [...day("2026-11-20", 0.5), ...day("2026-11-21", 1.25)],
      timezone: TZ,
      today: "2026-11-22",
    });
    expect(r.days).toEqual([
      { date: "2026-11-21", solar: { forecast: 4, actual: 5 }, load: { forecast: 24, actual: 30 } },
      {
        date: "2026-11-20",
        solar: { forecast: 10, actual: 8 },
        load: { forecast: 12, actual: 12 },
      },
    ]);
    // Production : (|4 − 5| + |10 − 8|) ÷ (5 + 8) ; consommation : 6 ÷ 42.
    expect(r.solarError).toBeCloseTo(3 / 13, 9);
    expect(r.loadError).toBeCloseTo(6 / 42, 9);
  });

  it("jour en cours ou sans mesure complète écarté ; rien à comparer → null", () => {
    const forecast = day("2026-11-22", 0).map((x) => ({ start: x.start, solarKwh: 0, loadKwh: 1 }));
    const r = compareForecast({
      forecast,
      solar: [],
      load: day("2026-11-22", 1),
      timezone: TZ,
      today: "2026-11-22",
    });
    expect(r).toEqual({ days: [], solarError: null, loadError: null });
  });
});
