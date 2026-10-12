import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { energyInterval, household, weatherDaily } from "@/db/schema";
import { heatingCost, type HeatingCost } from "@/domain/heating/cost";
import { heatingSeason, seasonDju, seasonStarting, type HeatingSeason } from "@/domain/heating/dju";
import { forecastRefill, SCENARIOS, type Forecast, type Scenario } from "@/domain/heating/forecast";
import {
  currentStock,
  lastPurchasePrice,
  seasonConsumption,
  toBaseQty,
  referencePrice,
  type Fuel,
} from "@/domain/heating/fuel";
import { visibleModules } from "@/domain/profile";
import { buildTimeline, priceTimeline } from "@/domain/tariff/timeline";
import type { PriceableInterval } from "@/domain/tariff/types";
import { cellOf, dju } from "@/domain/weather";
import { addDays, localParts, zonedInstant } from "@/lib/time";
import { listCategories } from "../categories";
import type { HouseholdContext } from "../context";
import { listContracts } from "../contracts";
import { listFuelEvents } from "../fuel";
import { pricingDays } from "../calendars";

// Vue Chauffage (T26) : coût de la saison (postes chauffage au moteur, énergie seule, et
// combustibles au prix moyen pondéré), consommations comparées à la saison précédente sur
// la même durée, degrés-jours et température de la commune.

export interface HeatingMonth {
  key: string;
  electricCents: number;
  pelletCents: number;
  woodCents: number;
  /** null : pas de météo pour ce mois. */
  dju: number | null;
  tMean: number | null;
}

export interface SeasonFigures {
  cost: HeatingCost;
  /** Consommation en unité de base (kg, stère) et méthode de calcul. */
  fuels: Partial<Record<Fuel, { qty: number; method: "events" | "snapshots" | "none" }>>;
  electricKwh: number;
  dju: number | null;
  tMean: number | null;
}

export interface HeatingView {
  season: HeatingSeason;
  /** Fin effective [from, to) : aujourd'hui pour la saison en cours. */
  to: string;
  inProgress: boolean;
  nav: { prev: number | null; next: number | null };
  current: SeasonFigures;
  /** Saison précédente sur la même durée ; null sans aucune donnée. */
  previous: SeasonFigures | null;
  months: HeatingMonth[];
  /** Mois sans détail pour un combustible estimé par relevés. */
  snapshotFuels: Fuel[];
  noLocation: boolean;
  /** Poids d'un sac de granulés (Réglages), pour afficher les kg en sacs. */
  bagKg: number;
  modules: { pellet: boolean; wood: boolean; electric: boolean };
}

const shiftYear = (day: string, years: number) =>
  `${Number(day.slice(0, 4)) + years}${day.slice(4)}`.replace(/-02-29$/, "-02-28");

async function weatherDays(
  cell: { latE2: number; lonE2: number } | null,
  from: string,
  to: string,
) {
  if (!cell) return [];
  return db
    .select({ date: weatherDaily.date, tMean: weatherDaily.tMean })
    .from(weatherDaily)
    .where(
      and(
        eq(weatherDaily.latE2, cell.latE2),
        eq(weatherDaily.lonE2, cell.lonE2),
        gte(weatherDaily.date, from),
        lt(weatherDaily.date, to),
      ),
    )
    .orderBy(asc(weatherDaily.date));
}

export async function getHeating(
  ctx: HouseholdContext,
  rawStartYear: string | undefined,
  now = new Date(),
): Promise<HeatingView> {
  const tz = ctx.timezone;
  const today = localParts(now, tz).date;
  const bounds = ctx.settings.heatingSeason;
  const latest = heatingSeason(today, bounds);
  const requested = Number(rawStartYear);
  const season =
    Number.isInteger(requested) && requested >= 2000 && requested < latest.startYear
      ? seasonStarting(requested, bounds)
      : latest;
  const end = addDays(today, 1);
  const to = season.to < end ? season.to : end;
  const previousSeason = seasonStarting(season.startYear - 1, bounds);
  const previousTo = shiftYear(to, -1);

  const vis = visibleModules(ctx.profile);
  const modules = { pellet: vis.pellet, wood: vis.wood, electric: vis.heatingCategories };
  const fuels: Fuel[] = [
    ...(modules.pellet ? (["pellet"] as const) : []),
    ...(modules.wood ? (["wood"] as const) : []),
  ];

  const [events, categories, contracts, home] = await Promise.all([
    listFuelEvents(ctx),
    listCategories(ctx, now),
    listContracts(ctx),
    db
      .select({ location: household.location })
      .from(household)
      .where(eq(household.id, ctx.householdId)),
  ]);
  const location = home[0]?.location ?? null;
  const cell = location ? cellOf(location) : null;
  const heatingMetrics = modules.electric
    ? categories.filter((c) => c.isHeating).map((c) => `category:${c.slug}`)
    : [];

  const electricIntervals = async (from: string, until: string): Promise<PriceableInterval[]> => {
    if (heatingMetrics.length === 0) return [];
    const rows = await db
      .select({
        start: energyInterval.start,
        granularity: energyInterval.granularity,
        kwh: energyInterval.kwh,
      })
      .from(energyInterval)
      .where(
        and(
          eq(energyInterval.householdId, ctx.householdId),
          inArray(energyInterval.metric, heatingMetrics),
          gte(energyInterval.start, zonedInstant(from, 0, tz)),
          lt(energyInterval.start, zonedInstant(until, 0, tz)),
        ),
      );
    return rows.map((r) =>
      r.granularity === "hour"
        ? { granularity: "hour", start: r.start, kwh: r.kwh }
        : { granularity: "day", date: localParts(r.start, tz).date, slot: null, kwh: r.kwh },
    );
  };

  const { calendars } = await pricingDays(ctx.householdId, addDays(previousSeason.from, -1), to, {
    timezone: ctx.timezone,
  });
  const pricing = { timezone: tz, ...calendars };
  const figures = async (from: string, until: string) => {
    // Chaque saison est chiffrée au prix de ses 12 derniers mois d'achats (SPEC §7.4).
    const priceAt = zonedInstant(until, 0, tz);
    const avgPrice = Object.fromEntries(
      fuels.map((f) => [f, referencePrice(events, f, ctx.settings, priceAt)?.perUnit ?? null]),
    ) as Record<Fuel, number | null>;
    const intervals = await electricIntervals(from, until);
    const priced =
      intervals.length > 0
        ? priceTimeline(intervals, buildTimeline(contracts, from, until, today), pricing)
        : null;
    const electricKwh = intervals.reduce((a, i) => a + i.kwh, 0);
    const window = { from: zonedInstant(from, 0, tz), to: zonedInstant(until, 0, tz) };
    const fuelUse = Object.fromEntries(
      fuels.map((f) => [f, seasonConsumption(events, f, window, ctx.settings)]),
    ) as SeasonFigures["fuels"];
    const weather = await weatherDays(cell, from, until);
    const djuTotal =
      weather.length > 0 ? seasonDju(weather, { ...season, from, to: until }).dju : null;
    const temps = weather.flatMap((w) => (w.tMean === null ? [] : [w.tMean]));
    const data: SeasonFigures = {
      cost: heatingCost({
        electric: modules.electric
          ? { kwh: electricKwh, energyCents: priced?.energyCents ?? 0 }
          : null,
        fuels: fuels.map((f) => ({
          fuel: f,
          qty: fuelUse[f]?.qty ?? 0,
          avgPricePerUnit: avgPrice[f],
        })),
        factors: ctx.settings.kwhFactors,
      }),
      fuels: fuelUse,
      electricKwh,
      dju: djuTotal,
      tMean: temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
    };
    return { data, byMonth: priced?.byMonth ?? {}, weather, avgPrice };
  };

  const current = await figures(season.from, to);
  const previous = await figures(previousSeason.from, previousTo);
  const previousHasData =
    previous.data.electricKwh > 0 ||
    Object.values(previous.data.fuels).some((f) => f && f.method !== "none");

  // Détail mensuel : consommations saisies (un combustible estimé par relevés n'a pas de
  // détail mensuel), électricité du moteur, météo de la commune.
  const monthOf = (d: Date) => localParts(d, tz).date.slice(0, 7);
  const months: HeatingMonth[] = [];
  for (let m = season.from.slice(0, 7); `${m}-01` < to;) {
    months.push({
      key: m,
      electricCents: current.byMonth[m]?.energyCents ?? 0,
      pelletCents: 0,
      woodCents: 0,
      dju: null,
      tMean: null,
    });
    const [y = 0, mm = 1] = m.split("-").map(Number);
    m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
  }
  const byKey = new Map(months.map((m) => [m.key, m]));
  const seasonStart = zonedInstant(season.from, 0, tz);
  const seasonEnd = zonedInstant(to, 0, tz);
  for (const e of events) {
    if (e.type !== "consumption" || e.at < seasonStart || e.at >= seasonEnd) continue;
    if (!fuels.includes(e.fuel) || current.data.fuels[e.fuel]?.method !== "events") continue;
    const month = byKey.get(monthOf(e.at));
    if (!month) continue;
    const cents = toBaseQty(e, ctx.settings) * (current.avgPrice[e.fuel] ?? 0) * 100;
    if (e.fuel === "pellet") month.pelletCents += cents;
    else month.woodCents += cents;
  }
  for (const m of months) {
    const days = current.weather.filter((w) => w.date.startsWith(m.key) && w.tMean !== null);
    if (days.length === 0) continue;
    m.dju = days.reduce((a, w) => a + (dju(w.tMean) ?? 0), 0);
    m.tMean = days.reduce((a, w) => a + (w.tMean ?? 0), 0) / days.length;
  }
  for (const m of months) {
    m.pelletCents = Math.round(m.pelletCents);
    m.woodCents = Math.round(m.woodCents);
  }

  return {
    season,
    to,
    inProgress: to < season.to,
    nav: {
      prev: previousHasData ? season.startYear - 1 : null,
      next: season.startYear < latest.startYear ? season.startYear + 1 : null,
    },
    current: current.data,
    previous: previousHasData ? previous.data : null,
    months,
    snapshotFuels: fuels.filter((f) => current.data.fuels[f]?.method === "snapshots"),
    noLocation: cell === null,
    bagKg: ctx.settings.pelletBagKg,
    modules,
  };
}

export interface FuelForecast {
  fuel: Fuel;
  /** Fin de la saison en cours (null hors saison), par scénario. */
  current: Record<Scenario, Forecast> | null;
  /** Saison suivante, par scénario (le stock réservé à la fin de saison est déduit). */
  next: Record<Scenario, Forecast>;
  currentLabel: string | null;
  nextLabel: string;
  /** Stock courant en unité de base. */
  stock: number;
}

export interface RefillForecastView {
  fuels: FuelForecast[];
  bagKg: number;
  /** Sacs par palette (équivalent palette de la commande). */
  bagsPerPallet: number;
}

/**
 * Prévision de réapprovisionnement (T27) pour chaque combustible actif : consommation par
 * DJU des deux dernières saisons terminées, DJU de référence, trois scénarios.
 */
export async function getRefillForecast(
  ctx: HouseholdContext,
  now = new Date(),
): Promise<RefillForecastView> {
  const tz = ctx.timezone;
  const today = localParts(now, tz).date;
  const bounds = ctx.settings.heatingSeason;
  const latest = heatingSeason(today, bounds);
  const inSeason = today < latest.to;
  const lastCompleted = inSeason ? latest.startYear - 1 : latest.startYear;
  const past = [lastCompleted, lastCompleted - 1].map((y) => seasonStarting(y, bounds));
  const nextSeason = seasonStarting(latest.startYear + 1, bounds);

  const vis = visibleModules(ctx.profile);
  const fuels: Fuel[] = [
    ...(vis.pellet ? (["pellet"] as const) : []),
    ...(vis.wood ? (["wood"] as const) : []),
  ];
  const [events, home] = await Promise.all([
    listFuelEvents(ctx),
    db
      .select({ location: household.location })
      .from(household)
      .where(eq(household.id, ctx.householdId)),
  ]);
  const location = home[0]?.location ?? null;
  const cell = location ? cellOf(location) : null;
  const pastDju = await Promise.all(
    past.map(async (s) => {
      const days = await weatherDays(cell, s.from, s.to);
      const r = seasonDju(days, s);
      // Une saison à moins de 90 % couverte par la météo n'est pas corrigée.
      return days.length > 0 && r.missingDays <= (r.days + r.missingDays) * 0.1 ? r.dju : null;
    }),
  );
  // DJU de la saison en cours jusqu'à aujourd'hui : sa consommation par DJU compte pour
  // prévoir l'hiver suivant (fin avril, l'hiver qui s'achève est le plus représentatif).
  const currentDju = inSeason
    ? await weatherDays(cell, latest.from, today).then((days) =>
        days.length > 0 ? seasonDju(days, { ...latest, to: today }).dju : null,
      )
    : null;
  const window = (s: HeatingSeason, until = s.to) => ({
    from: zonedInstant(s.from, 0, tz),
    to: zonedInstant(until, 0, tz),
  });

  return {
    bagKg: ctx.settings.pelletBagKg,
    bagsPerPallet: ctx.settings.pelletBagsPerPallet,
    fuels: fuels.map((fuel) => {
      const history = past.map((s, i) => ({
        label: s.label,
        consumed: seasonConsumption(events, fuel, window(s), ctx.settings).qty,
        dju: pastDju[i] ?? null,
      }));
      const stock = Math.max(0, currentStock(events, fuel, now, ctx.settings));
      const lastPricePerUnit = lastPurchasePrice(events, fuel, ctx.settings);
      const consumedNow = inSeason
        ? seasonConsumption(events, fuel, window(latest, addDays(today, 1)), ctx.settings).qty
        : 0;
      const byScenario = (target: "current" | "next") =>
        Object.fromEntries(
          (Object.keys(SCENARIOS) as Scenario[]).map((scenario) => {
            const base = { fuel, history, scenario, lastPricePerUnit, settings: ctx.settings };
            const current = forecastRefill({ ...base, stock, alreadyConsumed: consumedNow });
            if (target === "current") return [scenario, current];
            // Saison prochaine : le stock encore nécessaire pour finir l'hiver est réservé, et
            // l'hiver en cours rejoint l'historique.
            const reserved = inSeason && current.status === "ok" ? current.remaining : 0;
            const withCurrent = inSeason
              ? [
                  { label: latest.label, consumed: consumedNow, dju: currentDju, partial: true },
                  ...history,
                ]
              : history;
            return [
              scenario,
              forecastRefill({
                ...base,
                history: withCurrent,
                stock: Math.max(0, stock - reserved),
                alreadyConsumed: 0,
              }),
            ];
          }),
        ) as Record<Scenario, Forecast>;
      return {
        fuel,
        current: inSeason ? byScenario("current") : null,
        next: byScenario("next"),
        currentLabel: inSeason ? latest.label : null,
        nextLabel: nextSeason.label,
        stock,
      };
    }),
  };
}
