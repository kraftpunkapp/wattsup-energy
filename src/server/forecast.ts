import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { energyInterval, household } from "@/db/schema";
import { forecastSolar, learnSolarYield } from "@/domain/forecast/solar";
import { cellOf } from "@/domain/weather";
import { addDays, localParts, zonedInstant } from "@/lib/time";
import type { HouseholdContext } from "./context";
import { listEquipment } from "./equipment";
import { forecastHours } from "./weather/forecast";

// Prévisions « Demain » du foyer (SPEC §7.14) : aujourd'hui et demain, heure par heure.

/** Fenêtre d'apprentissage du rendement solaire (jours). */
const LEARNING_DAYS = 60;
const DAY_MS = 86_400_000;

/** Aujourd'hui et demain (jours locaux), en heures UTC [from, to). */
export function forecastWindow(timezone: string, now: Date) {
  const today = localParts(now, timezone).date;
  return {
    today,
    from: zonedInstant(today, 0, timezone),
    to: zonedInstant(addDays(today, 2), 0, timezone),
  };
}

/**
 * Production solaire prévue (T68) : null sans solaire dans le profil, sans commune, ou sans
 * historique ni puissance installée pour l'estimer.
 */
export async function getSolarForecast(ctx: HouseholdContext, now = new Date()) {
  if (!ctx.profile.solar) return null;
  const [home] = await db
    .select({ location: household.location })
    .from(household)
    .where(eq(household.id, ctx.householdId));
  if (!home?.location) return null;
  const cell = cellOf(home.location);
  const window = forecastWindow(ctx.timezone, now);
  const since = new Date(now.getTime() - LEARNING_DAYS * DAY_MS);

  const [production, weather, equipment] = await Promise.all([
    db
      .select({ start: energyInterval.start, kwh: energyInterval.kwh })
      .from(energyInterval)
      .where(
        and(
          eq(energyInterval.householdId, ctx.householdId),
          eq(energyInterval.metric, "solar_production"),
          eq(energyInterval.granularity, "hour"),
          gte(energyInterval.start, since),
          lt(energyInterval.start, now),
        ),
      )
      .orderBy(asc(energyInterval.start)),
    forecastHours(cell, since, window.to),
    listEquipment(ctx),
  ]);
  const kwc = equipment.find((e) => e.kind === "solar")?.capacity ?? null;
  const learned = learnSolarYield({
    production,
    weather: weather.filter((w) => w.start < now),
    timezone: ctx.timezone,
    kwc,
  });
  if (!learned) return null;
  return {
    method: learned.method,
    hours: forecastSolar(
      weather.filter((w) => w.start >= window.from),
      learned,
      ctx.timezone,
    ),
  };
}
