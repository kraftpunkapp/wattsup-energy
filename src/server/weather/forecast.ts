import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { weatherForecastHourly } from "@/db/schema";
import type { Cell, WeatherHour } from "@/domain/weather";
import type { HourlyForecastSource } from "./open-meteo";
import { knownCells } from "./sync";

// Prévisions météo heure par heure (T67, SPEC §7.14) : une requête par maille, jamais par
// foyer ; aujourd'hui et les deux jours suivants (UTC), soit au moins 36 h devant soi.

export const FORECAST_DAYS = 3;
/** Heures passées gardées : la journée en cours reste affichable, le reste est purgé. */
const KEEP_PAST_HOURS = 30;
const HOUR_MS = 3_600_000;

async function upsert(cell: Cell, hours: readonly WeatherHour[]) {
  if (hours.length === 0) return;
  await db
    .insert(weatherForecastHourly)
    .values(hours.map((h) => ({ ...cell, ...h })))
    .onConflictDoUpdate({
      target: [
        weatherForecastHourly.latE2,
        weatherForecastHourly.lonE2,
        weatherForecastHourly.start,
      ],
      set: {
        radiationWm2: sql`excluded.radiation_wm2`,
        temperatureC: sql`excluded.temperature_c`,
        fetchedAt: sql`now()`,
      },
    });
}

/** Rafraîchit chaque maille connue ; une maille en échec n'arrête pas les autres. */
export async function syncHourlyForecast(
  source: HourlyForecastSource,
  now = new Date(),
): Promise<{ cells: number; hours: number; failed: Cell[] }> {
  const cells = await knownCells();
  const failed: Cell[] = [];
  let hours = 0;
  for (const cell of cells) {
    try {
      const fetched = await source.hourly(cell, FORECAST_DAYS);
      await upsert(cell, fetched);
      hours += fetched.length;
    } catch {
      failed.push(cell);
    }
  }
  await db
    .delete(weatherForecastHourly)
    .where(lt(weatherForecastHourly.start, new Date(now.getTime() - KEEP_PAST_HOURS * HOUR_MS)));
  return { cells: cells.length, hours, failed };
}

/** Heures prévues d'une maille sur [from, to). */
export async function forecastHours(cell: Cell, from: Date, to: Date): Promise<WeatherHour[]> {
  return db
    .select({
      start: weatherForecastHourly.start,
      radiationWm2: weatherForecastHourly.radiationWm2,
      temperatureC: weatherForecastHourly.temperatureC,
    })
    .from(weatherForecastHourly)
    .where(
      and(
        eq(weatherForecastHourly.latE2, cell.latE2),
        eq(weatherForecastHourly.lonE2, cell.lonE2),
        gte(weatherForecastHourly.start, from),
        lt(weatherForecastHourly.start, to),
      ),
    )
    .orderBy(asc(weatherForecastHourly.start));
}
