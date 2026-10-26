import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { energyInterval, household, householdForecast, user, weatherDaily } from "@/db/schema";
import { compareForecast } from "@/domain/forecast/accuracy";
import { simulateBattery } from "@/domain/forecast/battery";
import { forecastDayLoad, heatingSlope } from "@/domain/forecast/load";
import { forecastSolar, learnSolarYield } from "@/domain/forecast/solar";
import { daySummaries } from "@/domain/forecast/summary";
import { bestWindow, marginalCosts } from "@/domain/forecast/windows";
import { hourlyKwhPrices } from "@/domain/tariff/engine";
import { currentContract, gridAt } from "@/domain/tariff/timeline";
import { cellOf, dju, type Cell } from "@/domain/weather";
import { addDays, localParts, zonedInstant } from "@/lib/time";
import { householdContextFor, type HouseholdContext } from "./context";
import { listAppliances } from "./appliances";
import { pricingDays } from "./calendars";
import { listContracts } from "./contracts";
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
async function householdCell(ctx: HouseholdContext): Promise<Cell | null> {
  const [home] = await db
    .select({ location: household.location })
    .from(household)
    .where(eq(household.id, ctx.householdId));
  return home?.location ? cellOf(home.location) : null;
}

export async function getSolarForecast(ctx: HouseholdContext, now = new Date()) {
  if (!ctx.profile.solar) return null;
  const cell = await householdCell(ctx);
  if (!cell) return null;
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

const LOAD_METRICS = [
  "grid_import",
  "grid_export",
  "solar_production",
  "battery_charge",
  "battery_discharge",
] as const;

/** Consommation horaire du foyer = import + production + décharge − export − charge. */
async function loadHistory(ctx: HouseholdContext, since: Date, now: Date) {
  const rows = await db
    .select({ start: energyInterval.start, metric: energyInterval.metric, kwh: energyInterval.kwh })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        eq(energyInterval.granularity, "hour"),
        inArray(energyInterval.metric, [...LOAD_METRICS]),
        gte(energyInterval.start, since),
        lt(energyInterval.start, now),
      ),
    );
  const sign: Record<string, number> = {
    grid_import: 1,
    solar_production: 1,
    battery_discharge: 1,
    grid_export: -1,
    battery_charge: -1,
  };
  const byHour = new Map<number, number>();
  for (const r of rows) {
    const t = r.start.getTime();
    byHour.set(t, (byHour.get(t) ?? 0) + (sign[r.metric] ?? 0) * r.kwh);
  }
  return [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, kwh]) => ({ start: new Date(t), kwh: Math.max(0, kwh) }));
}

/** Degrés-jours de chauffage passés de la maille (moyenne journalière, base 18 °C). */
async function pastHdd(cell: Cell, from: string) {
  const rows = await db
    .select({ date: weatherDaily.date, tMean: weatherDaily.tMean })
    .from(weatherDaily)
    .where(
      and(
        eq(weatherDaily.latE2, cell.latE2),
        eq(weatherDaily.lonE2, cell.lonE2),
        gte(weatherDaily.date, from),
      ),
    );
  return new Map(rows.flatMap((r) => (r.tMean === null ? [] : [[r.date, dju(r.tMean) as number]])));
}

/**
 * Aujourd'hui et demain heure par heure (T69) : production et consommation prévues, batterie
 * simulée, achats et surplus au réseau. null en envoi quotidien ou sans historique horaire.
 */
export async function getDayAheadForecast(ctx: HouseholdContext, now = new Date()) {
  if (ctx.granularity !== "hourly") return null;
  const window = forecastWindow(ctx.timezone, now);
  const since = new Date(now.getTime() - LEARNING_DAYS * DAY_MS);
  const [history, solar, cell, equipment] = await Promise.all([
    loadHistory(ctx, since, now),
    getSolarForecast(ctx, now),
    householdCell(ctx),
    listEquipment(ctx),
  ]);

  // Chauffage électrique : pente apprise sur la consommation des jours passés.
  let heating: {
    slope: number;
    hddByDate: Map<string, number>;
    targets: Map<string, number>;
  } | null = null;
  if (ctx.profile.electricHeating && cell) {
    const hddByDate = await pastHdd(cell, localParts(since, ctx.timezone).date);
    const daily = new Map<string, number>();
    for (const x of history) {
      const d = localParts(x.start, ctx.timezone).date;
      daily.set(d, (daily.get(d) ?? 0) + x.kwh);
    }
    const slope = heatingSlope(
      [...daily.entries()].flatMap(([d, load]) =>
        hddByDate.has(d) ? [{ load, hdd: hddByDate.get(d) as number }] : [],
      ),
    );
    // Température moyenne prévue de chaque jour → degrés-jours.
    const temps = new Map<string, number[]>();
    for (const w of await forecastHours(cell, window.from, window.to)) {
      if (w.temperatureC === null) continue;
      const d = localParts(w.start, ctx.timezone).date;
      temps.set(d, [...(temps.get(d) ?? []), w.temperatureC]);
    }
    const targets = new Map(
      [...temps.entries()].map(([d, t]) => [
        d,
        dju(t.reduce((a, b) => a + b, 0) / t.length) as number,
      ]),
    );
    heating = { slope, hddByDate, targets };
  }

  const solarByStart = new Map((solar?.hours ?? []).map((h) => [h.start.getTime(), h.kwh]));
  const hours: { start: Date; solarKwh: number; loadKwh: number }[] = [];
  for (const date of [window.today, addDays(window.today, 1)]) {
    const target = heating?.targets.get(date);
    const load = forecastDayLoad({
      history,
      date,
      timezone: ctx.timezone,
      heating:
        heating && target !== undefined
          ? { slope: heating.slope, hddByDate: heating.hddByDate, targetHdd: target }
          : null,
    });
    if (!load) return null;
    // Heures UTC du jour local (23 ou 25 au changement d'heure).
    for (
      let t = zonedInstant(date, 0, ctx.timezone).getTime();
      t < zonedInstant(addDays(date, 1), 0, ctx.timezone).getTime();
      t += 3_600_000
    ) {
      const start = new Date(t);
      hours.push({
        start,
        solarKwh: solarByStart.get(t) ?? 0,
        loadKwh: load[localParts(start, ctx.timezone).hour] ?? 0,
      });
    }
  }
  const capacity = ctx.profile.battery
    ? (equipment.find((e) => e.kind === "battery")?.capacity ?? 0)
    : 0;
  return {
    solarMethod: solar?.method ?? null,
    ...simulateBattery(hours, capacity, ctx.timezone),
  };
}

/**
 * Prévision chiffrée (T70) : prix du kWh du contrat en cours à chaque heure (créneaux, Tempo,
 * spot, sobriété) et coût d'un kWh de plus, surplus solaire compris. `priced` est null sans
 * contrat en cours (production et consommation restent affichables).
 */
export async function getPricedForecast(ctx: HouseholdContext, now = new Date()) {
  const forecast = await getDayAheadForecast(ctx, now);
  if (!forecast) return null;
  const window = forecastWindow(ctx.timezone, now);
  const current = currentContract(await listContracts(ctx), window.today);
  if (!current) return { ...forecast, priced: null };
  const until = addDays(window.today, 2);
  // La veille est incluse : de 0 h à 6 h, c'est encore son jour Tempo.
  const { calendars } = await pricingDays(ctx.householdId, addDays(window.today, -1), until, {
    timezone: ctx.timezone,
  });
  const { prices, assumedTempoDays } = hourlyKwhPrices(
    forecast.hours.map((h) => h.start),
    gridAt(current, window.today),
    { timezone: ctx.timezone, period: { from: window.today, to: until }, ...calendars },
  );
  const exportPriceEur = ctx.settings.exportEnabled ? ctx.settings.exportPriceEurKwh : 0;
  return {
    ...forecast,
    priced: {
      hours: marginalCosts(forecast.hours, prices, exportPriceEur),
      exportPriceEur,
      assumedTempoDays,
    },
  };
}

/**
 * Page Prévisions et carte « Demain » (T72) : prévision chiffrée, bilan de chaque jour et
 * meilleur créneau de chaque appareil (à partir de maintenant, jusqu'à la fin de demain).
 */
export async function getForecastPlan(ctx: HouseholdContext, now = new Date()) {
  if (ctx.granularity !== "hourly") return { status: "daily" as const };
  const [forecast, appliances] = await Promise.all([
    getPricedForecast(ctx, now),
    listAppliances(ctx),
  ]);
  if (!forecast) return { status: "no-data" as const };
  const priced = forecast.priced;
  const windows = priced
    ? appliances.map((appliance) => ({
        appliance,
        window: bestWindow(priced.hours, appliance, ctx.timezone, now, priced.exportPriceEur),
      }))
    : [];
  return {
    status: "ok" as const,
    today: forecastWindow(ctx.timezone, now).today,
    hours: forecast.hours,
    fullAt: forecast.fullAt,
    solarMethod: forecast.solarMethod,
    priced,
    days: daySummaries(
      forecast.hours,
      priced?.hours.map((h) => h.priceEurKwh) ?? null,
      ctx.timezone,
    ),
    appliances: appliances.length,
    windows,
  };
}

export type ForecastPlan = Awaited<ReturnType<typeof getForecastPlan>>;

/** Prévisions figées gardées (jours) ; la fiabilité porte sur les 7 derniers. */
const KEEP_SNAPSHOT_DAYS = 30;
const ACCURACY_DAYS = 7;

/**
 * Fige la prévision de demain du foyer (T73) : rejouée le même soir, elle remplace la
 * précédente. Rien en envoi quotidien ou sans historique.
 */
export async function snapshotForecast(ctx: HouseholdContext, now = new Date()): Promise<number> {
  const forecast = await getDayAheadForecast(ctx, now);
  if (!forecast) return 0;
  const tomorrow = addDays(forecastWindow(ctx.timezone, now).today, 1);
  const rows = forecast.hours
    .filter((h) => localParts(h.start, ctx.timezone).date === tomorrow)
    .map((h) => ({
      householdId: ctx.householdId,
      start: h.start,
      solarKwh: h.solarKwh,
      loadKwh: h.loadKwh,
    }));
  if (rows.length === 0) return 0;
  await db
    .insert(householdForecast)
    .values(rows)
    .onConflictDoUpdate({
      target: [householdForecast.householdId, householdForecast.start],
      set: {
        solarKwh: sql`excluded.solar_kwh`,
        loadKwh: sql`excluded.load_kwh`,
        madeAt: sql`now()`,
      },
    });
  return rows.length;
}

/** Tâche du soir : chaque foyer actif en envoi horaire ; purge au-delà de 30 jours. */
export async function snapshotForecastsForAll(now = new Date()): Promise<{ households: number }> {
  const rows = await db
    .select({ ownerId: household.ownerId, name: user.name, email: user.email })
    .from(household)
    .innerJoin(user, eq(user.id, household.ownerId))
    .where(and(eq(household.granularity, "hourly"), isNull(user.disabledAt)));
  let done = 0;
  for (const r of rows) {
    try {
      if ((await snapshotForecast(await householdContextFor(r.ownerId, r.name, r.email), now)) > 0)
        done += 1;
    } catch (err) {
      console.error("[prévisions] instantané impossible pour un foyer :", err);
    }
  }
  await db
    .delete(householdForecast)
    .where(lt(householdForecast.start, new Date(now.getTime() - KEEP_SNAPSHOT_DAYS * DAY_MS)));
  return { households: done };
}

/** Prévu contre réel des 7 derniers jours (T73). */
export async function getForecastAccuracy(ctx: HouseholdContext, now = new Date()) {
  const today = localParts(now, ctx.timezone).date;
  const since = zonedInstant(addDays(today, -ACCURACY_DAYS), 0, ctx.timezone);
  const until = zonedInstant(today, 0, ctx.timezone);
  const [forecast, load, solar] = await Promise.all([
    db
      .select({
        start: householdForecast.start,
        solarKwh: householdForecast.solarKwh,
        loadKwh: householdForecast.loadKwh,
      })
      .from(householdForecast)
      .where(
        and(
          eq(householdForecast.householdId, ctx.householdId),
          gte(householdForecast.start, since),
          lt(householdForecast.start, until),
        ),
      ),
    loadHistory(ctx, since, until),
    db
      .select({ start: energyInterval.start, kwh: energyInterval.kwh })
      .from(energyInterval)
      .where(
        and(
          eq(energyInterval.householdId, ctx.householdId),
          eq(energyInterval.metric, "solar_production"),
          eq(energyInterval.granularity, "hour"),
          gte(energyInterval.start, since),
          lt(energyInterval.start, until),
        ),
      ),
  ]);
  return compareForecast({ forecast, solar, load, timezone: ctx.timezone, today });
}
