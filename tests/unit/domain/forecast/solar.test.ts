import { describe, expect, it } from "vitest";
import { forecastSolar, learnSolarYield } from "@/domain/forecast/solar";
import type { WeatherHour } from "@/domain/weather";

// Production solaire prévue (T68, SPEC §7.14) : rendement du foyer appris heure par heure
// (kWh produits ÷ kWh/m² reçus), appliqué au rayonnement prévu. Fuseau Europe/Paris, UTC+1
// en novembre : l'heure locale vaut l'heure UTC + 1.

const TZ = "Europe/Paris";
const HOUR = 3_600_000;
/** Rayonnement en cloche de 8 h à 16 h UTC (9 h – 17 h locales), en W/m². */
const bell = (utcHour: number) =>
  utcHour >= 8 && utcHour < 16 ? 600 - Math.abs(utcHour - 11.5) * 140 : 0;

/** `days` jours de novembre : météo et production, panneaux orientés est (2× le matin). */
function history(days: number) {
  const weather: WeatherHour[] = [];
  const production: { start: Date; kwh: number }[] = [];
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      const start = new Date(Date.UTC(2026, 10, 1 + d, h));
      const wh = bell(h);
      weather.push({ start, radiationWm2: wh, temperatureC: 8 });
      // Avant midi local (11 h UTC) : 2 kWh par kWh/m² ; après : 1.
      if (wh > 0) production.push({ start, kwh: (wh / 1000) * (h + 1 < 12 ? 2 : 1) });
    }
  }
  return { weather, production };
}

/** Rendement appris (le test échoue s'il n'y en a pas). */
function learned(input: Parameters<typeof learnSolarYield>[0]) {
  const y = learnSolarYield(input);
  if (!y) throw new Error("aucun rendement");
  return y;
}

describe("learnSolarYield", () => {
  it("rendement appris par heure locale, sur les heures assez ensoleillées", () => {
    const { weather, production } = history(20);
    const y = learned({ production, weather, timezone: TZ, kwc: 6 });
    expect(y.method).toBe("learned");
    expect(y.byHour[9]).toBeCloseTo(2, 6); // 8 h UTC = 9 h locales, le matin
    expect(y.byHour[15]).toBeCloseTo(1, 6);
  });

  it("moins de 14 jours de production : puissance × 0,8 à toute heure", () => {
    const { weather, production } = history(10);
    const y = learned({ production, weather, timezone: TZ, kwc: 6 });
    expect(y.method).toBe("kwc");
    expect(y.byHour[12]).toBeCloseTo(4.8, 6);
  });

  it("production connue mais aucune météo correspondante : puissance × 0,8", () => {
    const { production } = history(20);
    const y = learnSolarYield({ production, weather: [], timezone: TZ, kwc: 3 });
    expect(y?.method).toBe("kwc");
    expect(y?.byHour[12]).toBeCloseTo(2.4, 6);
  });

  it("sans historique ni puissance : pas de prévision", () => {
    expect(learnSolarYield({ production: [], weather: [], timezone: TZ, kwc: null })).toBeNull();
  });

  it("heure trop peu ensoleillée dans l'historique : rendement moyen du foyer", () => {
    const { weather, production } = history(20);
    const y = learned({ production, weather, timezone: TZ, kwc: 6 });
    // 7 h locales : jamais de soleil dans l'historique de novembre.
    const total = production.reduce((a, p) => a + p.kwh, 0);
    const received = weather.reduce((a, w) => a + (w.radiationWm2 ?? 0) / 1000, 0);
    expect(y.byHour[7]).toBeCloseTo(total / received, 6);
  });
});

describe("forecastSolar", () => {
  it("rayonnement prévu × rendement de l'heure, en kWh", () => {
    const { weather, production } = history(20);
    const y = learned({ production, weather, timezone: TZ, kwc: 6 });
    const start = new Date(Date.UTC(2026, 10, 25, 8)); // 9 h locales
    const hours = [
      { start, radiationWm2: 500, temperatureC: 6 },
      { start: new Date(start.getTime() + 6 * HOUR), radiationWm2: 300, temperatureC: 6 },
      { start: new Date(start.getTime() + 12 * HOUR), radiationWm2: null, temperatureC: 6 },
    ];
    expect(forecastSolar(hours, y, TZ)).toEqual([
      { start: hours[0]?.start, kwh: expect.closeTo(1, 6) },
      { start: hours[1]?.start, kwh: expect.closeTo(0.3, 6) },
      { start: hours[2]?.start, kwh: 0 },
    ]);
  });
});
