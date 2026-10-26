import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { weatherForecastHourly } from "@/db/schema";
import { cellOf, type Cell, type WeatherHour } from "@/domain/weather";
import { setLocation } from "@/server/location";
import { forecastHours, syncHourlyForecast } from "@/server/weather/forecast";
import type { HourlyForecastSource } from "@/server/weather/open-meteo";
import { createTestHousehold } from "../helpers/tenancy";

// Prévisions météo heure par heure (T67) : une requête par maille, valeurs remplacées au
// rafraîchissement, heures anciennes purgées. Source factice, aucun appel réseau.

const now = new Date("2026-10-26T12:00:00Z");
const hour = (iso: string, radiationWm2: number | null, temperatureC = 10): WeatherHour => ({
  start: new Date(iso),
  radiationWm2,
  temperatureC,
});

let n = 0;
async function locatedCell(): Promise<Cell> {
  n += 1;
  const ctx = await createTestHousehold("prevision");
  const location = { label: `Prévision ${n}`, lat: 30 + n / 100, lon: 40 + n / 100 };
  await setLocation(ctx, location);
  return cellOf(location);
}

const rowsFor = (cell: Cell) =>
  db
    .select()
    .from(weatherForecastHourly)
    .where(
      and(eq(weatherForecastHourly.latE2, cell.latE2), eq(weatherForecastHourly.lonE2, cell.lonE2)),
    )
    .orderBy(weatherForecastHourly.start);

describe("prévisions météo horaires", () => {
  it("une requête par maille sur 3 jours ; rafraîchir remplace, une maille en panne n'arrête rien", async () => {
    const cell = await locatedCell();
    const broken = await locatedCell();
    let radiation = 300;
    const calls: number[] = [];
    const source: HourlyForecastSource = {
      hourly: async (c, days) => {
        if (c.latE2 === broken.latE2 && c.lonE2 === broken.lonE2) throw new Error("panne");
        calls.push(days);
        return [hour("2026-10-26T12:00:00Z", radiation), hour("2026-10-27T11:00:00Z", 450)];
      },
    };
    const first = await syncHourlyForecast(source, now);
    expect(first.failed).toContainEqual(broken);
    expect(calls.every((d) => d === 3)).toBe(true);
    radiation = 120;
    await syncHourlyForecast(source, now);
    const rows = await rowsFor(cell);
    expect(rows.map((r) => [r.start.toISOString(), r.radiationWm2])).toEqual([
      ["2026-10-26T12:00:00.000Z", 120],
      ["2026-10-27T11:00:00.000Z", 450],
    ]);
    const read = await forecastHours(
      cell,
      new Date("2026-10-27T00:00:00Z"),
      new Date("2026-10-28T00:00:00Z"),
    );
    expect(read).toEqual([hour("2026-10-27T11:00:00Z", 450)]);
  });

  it("les heures de plus de 30 h sont purgées", async () => {
    const cell = await locatedCell();
    const source: HourlyForecastSource = {
      hourly: async () => [hour("2026-10-24T12:00:00Z", 200), hour("2026-10-26T13:00:00Z", 300)],
    };
    await syncHourlyForecast(source, now);
    expect((await rowsFor(cell)).map((r) => r.start.toISOString())).toEqual([
      "2026-10-26T13:00:00.000Z",
    ]);
  });
});
