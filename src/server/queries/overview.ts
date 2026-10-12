import {
  and,
  asc,
  countDistinct,
  eq,
  gte,
  inArray,
  like,
  lt,
  min,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { db } from "@/db";
import { energyInterval, household, weatherDaily } from "@/db/schema";
import {
  coverageWindow,
  energyBalance,
  expectedSlots,
  parsePeriod,
  peakSplit,
  periodNav,
  slotHpHc,
  solarSavingEstimate,
  solarYield,
  nextMonth,
  yearMonths,
  type EnergyBalance,
  type PeakSplit,
  type Period,
} from "@/domain/overview";
import { batteryGaps, type BatteryGap, type BatteryMonth } from "@/domain/battery-data";
import { projectYear, type Projection } from "@/domain/projection";
import {
  baseloadBetween,
  baseloadMonths,
  monthsEndingAt,
  nightlyMinima,
  type NightHour,
} from "@/domain/baseload";
import { autoMarkers, markersBetween, type Marker } from "@/domain/markers";
import { visibleModules } from "@/domain/profile";
import {
  buildTimeline,
  currentContract,
  priceTimeline,
  type TimelineResult,
} from "@/domain/tariff/timeline";
import type { PriceableInterval } from "@/domain/tariff/types";
import { cellOf, radiationKwhM2, sunshineHours } from "@/domain/weather";
import { addDays, eachDay, localParts, zonedInstant } from "@/lib/time";
import { listCategories } from "../categories";
import type { HouseholdContext } from "../context";
import { listContracts } from "../contracts";
import { listEquipment } from "../equipment";
import { listMarkers } from "../markers";
import { pricingDays } from "../calendars";

// Vue d'ensemble (T20) : budget réel (contrat et grille en vigueur chaque jour), coût
// mensuel, bilan et origine de la consommation, postes, production et ensoleillement.
// Tous les jours, mois et bornes sont ceux du fuseau du foyer.

/** Chiffres d'un mois pour l'histogramme et le tableau mensuel. */
export interface MonthFigures {
  energyCents: number;
  subscriptionCents: number;
  /** kWh soutirés au réseau, dont heures pleines et heures creuses (0 sans créneau). */
  kwh: number;
  hpKwh: number;
  hcKwh: number;
  /** Production solaire (kWh), et économie estimée au prix moyen du mois (null sans prix). */
  solarKwh: number;
  solarSavingCents: number | null;
}

export interface MonthCost extends MonthFigures {
  key: string;
  /** Même mois de l'année précédente (mois entier), null sans donnée. */
  previous: MonthFigures | null;
}

export interface SolarPoint {
  /** Jour « AAAA-MM-JJ » (vue mois) ou mois « AAAA-MM » (vue année). */
  key: string;
  kwh: number;
  sunshineHours: number | null;
  /** Production du même jour (ou mois) un an plus tôt, null sans donnée. */
  previousKwh: number | null;
}

export type Overview =
  | { status: "no-data" }
  | {
      status: "ok";
      period: Period;
      nav: { prev: string | null; next: string | null };
      granularity: "hourly" | "daily";
      /** Part des heures (horaire) ou des jours (quotidien) reçus sur les jours terminés. */
      coverage: number | null;
      budget: {
        /** null : aucun contrat pour chiffrer l'électricité. */
        totalCents: number | null;
        energyCents: number;
        subscriptionCents: number;
        /** Même période un an plus tôt (mêmes jours), null sans données. */
        previousCents: number | null;
        unknownContractDays: number;
      };
      /** Coût et kWh soutirés par mois de l'année de la période. */
      months: MonthCost[];
      balance: EnergyBalance;
      /**
       * Part HP / HC de l'électricité soutirée sur la période, si le contrat en cours a des
       * heures creuses (HP/HC ou Tempo) ; `approximated` : une part des kWh (envois
       * quotidiens sans créneau) a été répartie par supposition.
       */
      peak: (PeakSplit & { approximated: boolean }) | null;
      /** Repères de l'année de la période (saisis et automatiques), triés par date. */
      markers: Marker[];
      /** Mois de la période où la batterie a une charge sans décharge, ou l'inverse. */
      batteryGaps: BatteryGap[];
      categories: {
        id: string;
        name: string;
        icon: string | null;
        color: string | null;
        isHeating: boolean;
        kwh: number;
      }[];
      /**
       * Projection de la dépense d'électricité de l'année en cours (abonnement compris) ;
       * null pour une année passée, sans contrat ou sans base de comparaison.
       */
      projection: Projection | null;
      /**
       * Talon de consommation (envois horaires seulement, sinon null) : période choisie,
       * même période un an plus tôt, 12 derniers mois jusqu'à la fin de la période.
       */
      baseload: {
        /** null : moins de 7 nuits complètes sur la période. */
        watts: number | null;
        previousWatts: number | null;
        months: { month: string; watts: number | null }[];
        /** Prix moyen du kWh soutiré sur l'année (hors abonnement), null sans contrat. */
        centsPerKwh: number | null;
      } | null;
      solar: {
        points: SolarPoint[];
        kwh: number;
        /** kWh produits par kWh/m² reçu, et la même période un an plus tôt. */
        yield: number | null;
        previousYield: number | null;
        /** Aucune commune : pas de météo à mettre en regard. */
        noLocation: boolean;
      } | null;
    };

const shiftYear = (day: string, years: number) =>
  `${Number(day.slice(0, 4)) + years}${day.slice(4)}`.replace(/-02-29$/, "-02-28");

export async function gridIntervals(ctx: HouseholdContext, from: string, to: string) {
  const rows = await db
    .select({
      start: energyInterval.start,
      granularity: energyInterval.granularity,
      tariffSlot: energyInterval.tariffSlot,
      kwh: energyInterval.kwh,
    })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        eq(energyInterval.metric, "grid_import"),
        gte(energyInterval.start, zonedInstant(from, 0, ctx.timezone)),
        lt(energyInterval.start, zonedInstant(to, 0, ctx.timezone)),
      ),
    )
    .orderBy(asc(energyInterval.start));
  return rows.map((r): PriceableInterval =>
    r.granularity === "hour"
      ? { granularity: "hour", start: r.start, kwh: r.kwh }
      : {
          granularity: "day",
          date: localParts(r.start, ctx.timezone).date,
          slot: r.tariffSlot === "all" ? null : r.tariffSlot,
          kwh: r.kwh,
        },
  );
}

/**
 * Consommation du foyer heure par heure, de minuit à 6 h (heure locale) : import + production
 * + décharge − export − charge. Les heures sans import (donnée manquante) sont écartées.
 */
async function nightHours(ctx: HouseholdContext, from: string, to: string): Promise<NightHour[]> {
  const local = sql`(${energyInterval.start} at time zone ${ctx.timezone})`;
  const k = energyInterval.kwh;
  const rows = await db
    .select({
      date: sql<string>`to_char(${local}, 'YYYY-MM-DD')`,
      hour: sql<number>`extract(hour from ${local})::int`,
      kwh: sql<number>`sum(case ${energyInterval.metric}
          when 'grid_import' then ${k} when 'solar_production' then ${k}
          when 'battery_discharge' then ${k}
          when 'grid_export' then -${k} when 'battery_charge' then -${k} else 0 end)`.mapWith(
        Number,
      ),
      hasImport: sql<boolean>`bool_or(${energyInterval.metric} = 'grid_import')`,
    })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        eq(energyInterval.granularity, "hour"),
        gte(energyInterval.start, zonedInstant(from, 0, ctx.timezone)),
        lt(energyInterval.start, zonedInstant(to, 0, ctx.timezone)),
        sql`extract(hour from ${local}) < 6`,
      ),
    )
    .groupBy(energyInterval.start);
  return rows.filter((r) => r.hasImport).map(({ date, hour, kwh }) => ({ date, hour, kwh }));
}

async function totalsByMetric(ctx: HouseholdContext, from: string, to: string) {
  const rows = await db
    .select({ metric: energyInterval.metric, kwh: sum(energyInterval.kwh).mapWith(Number) })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        gte(energyInterval.start, zonedInstant(from, 0, ctx.timezone)),
        lt(energyInterval.start, zonedInstant(to, 0, ctx.timezone)),
      ),
    )
    .groupBy(energyInterval.metric);
  return Object.fromEntries(rows.map((r) => [r.metric, r.kwh]));
}

const SOLAR_METRICS = ["solar_production", "grid_export", "battery_charge", "battery_charge_grid"];

/** Production solaire, export et charge de la batterie par mois local et par compteur. */
async function solarMonths(ctx: HouseholdContext, from: string, to: string) {
  const local = sql`(${energyInterval.start} at time zone ${ctx.timezone})`;
  const rows = await db
    .select({
      month: sql<string>`to_char(${local}, 'YYYY-MM')`,
      metric: energyInterval.metric,
      kwh: sum(energyInterval.kwh).mapWith(Number),
    })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        inArray(energyInterval.metric, SOLAR_METRICS),
        gte(energyInterval.start, zonedInstant(from, 0, ctx.timezone)),
        lt(energyInterval.start, zonedInstant(to, 0, ctx.timezone)),
      ),
    )
    .groupBy(sql`1`, energyInterval.metric);
  const months = new Map<string, Record<string, number>>();
  for (const r of rows) months.set(r.month, { ...months.get(r.month), [r.metric]: r.kwh });
  return months;
}

/** Charge et décharge de la batterie par mois local. */
async function batteryMonths(ctx: HouseholdContext, from: string, to: string) {
  const local = sql`(${energyInterval.start} at time zone ${ctx.timezone})`;
  const rows = await db
    .select({
      month: sql<string>`to_char(${local}, 'YYYY-MM')`,
      metric: energyInterval.metric,
      kwh: sum(energyInterval.kwh).mapWith(Number),
    })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        inArray(energyInterval.metric, ["battery_charge", "battery_discharge"]),
        gte(energyInterval.start, zonedInstant(from, 0, ctx.timezone)),
        lt(energyInterval.start, zonedInstant(to, 0, ctx.timezone)),
      ),
    )
    .groupBy(sql`1`, energyInterval.metric);
  const months = new Map<string, BatteryMonth>();
  for (const r of rows) {
    const m = months.get(r.month) ?? { month: r.month, charge: 0, discharge: 0 };
    if (r.metric === "battery_charge") m.charge = r.kwh;
    else m.discharge = r.kwh;
    months.set(r.month, m);
  }
  return [...months.values()];
}

/** Part des créneaux attendus effectivement reçus pour l'import réseau, null sans jour terminé. */
async function periodCoverage(ctx: HouseholdContext, period: Period, today: string) {
  const window = coverageWindow(period, today);
  if (!window) return null;
  const [row] = await db
    .select({ received: countDistinct(energyInterval.start) })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        eq(energyInterval.metric, "grid_import"),
        gte(energyInterval.start, zonedInstant(window.from, 0, ctx.timezone)),
        lt(energyInterval.start, zonedInstant(window.to, 0, ctx.timezone)),
      ),
    );
  const expected = expectedSlots(window.from, window.to, ctx.granularity, ctx.timezone);
  return expected > 0 ? Math.min(1, (row?.received ?? 0) / expected) : null;
}

/** Production solaire et météo par jour (vue mois) ou par mois (vue année). */
async function solarSeries(
  ctx: HouseholdContext,
  from: string,
  to: string,
  byMonth: boolean,
  cell: { latE2: number; lonE2: number } | null,
) {
  const local = sql`(${energyInterval.start} at time zone ${ctx.timezone})`;
  const keyExpr = byMonth
    ? sql<string>`to_char(${local}, 'YYYY-MM')`
    : sql<string>`to_char(${local}, 'YYYY-MM-DD')`;
  const production = await db
    .select({ key: keyExpr, kwh: sum(energyInterval.kwh).mapWith(Number) })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        eq(energyInterval.metric, "solar_production"),
        gte(energyInterval.start, zonedInstant(from, 0, ctx.timezone)),
        lt(energyInterval.start, zonedInstant(to, 0, ctx.timezone)),
      ),
    )
    // Regroupement par position : le fuseau est un paramètre, l'expression répétée ne
    // serait pas reconnue identique par Postgres.
    .groupBy(sql`1`);
  const weather = cell
    ? await db
        .select({
          date: weatherDaily.date,
          sunshineS: weatherDaily.sunshineS,
          radiation: weatherDaily.radiationMjM2,
        })
        .from(weatherDaily)
        .where(
          and(
            eq(weatherDaily.latE2, cell.latE2),
            eq(weatherDaily.lonE2, cell.lonE2),
            gte(weatherDaily.date, from),
            lt(weatherDaily.date, to),
          ),
        )
    : [];
  const sunshine = new Map<string, number>();
  let radiation = 0;
  let radiationDays = 0;
  for (const w of weather) {
    const key = byMonth ? w.date.slice(0, 7) : w.date;
    const h = sunshineHours(w.sunshineS);
    if (h !== null) sunshine.set(key, (sunshine.get(key) ?? 0) + h);
    const r = radiationKwhM2(w.radiation);
    if (r !== null) {
      radiation += r;
      radiationDays += 1;
    }
  }
  const kwhByKey = new Map(production.map((p) => [p.key, p.kwh]));
  return { kwhByKey, sunshine, radiation: radiationDays > 0 ? radiation : null };
}

export async function getOverview(
  ctx: HouseholdContext,
  rawPeriod: string | undefined,
  now = new Date(),
): Promise<Overview> {
  const tz = ctx.timezone;
  const today = localParts(now, tz).date;
  const [first] = await db
    .select({ start: min(energyInterval.start) })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        or(eq(energyInterval.metric, "grid_import"), like(energyInterval.metric, "solar%")),
      ),
    );
  if (!first?.start) return { status: "no-data" };
  const firstDay = localParts(first.start, tz).date;

  const period = parsePeriod(rawPeriod, today);
  const year = period.key.slice(0, 4);
  const yearFrom = `${year}-01-01`;
  const yearTo = [`${Number(year) + 1}-01-01`, addDays(today, 1)].sort()[0] as string;
  const previous = { from: shiftYear(period.from, -1), to: shiftYear(period.to, -1) };

  // Année précédente entière : comparaison mois par mois (N-1) et même période (budget).
  const previousYearFrom = `${Number(year) - 1}-01-01`;
  const modules = visibleModules(ctx.profile);
  const [
    contracts,
    intervals,
    previousYearIntervals,
    totals,
    categories,
    home,
    coverage,
    battery,
    savedMarkers,
    equipment,
    solarByMonth,
    nights,
  ] = await Promise.all([
    listContracts(ctx),
    gridIntervals(ctx, yearFrom, yearTo),
    gridIntervals(ctx, previousYearFrom, yearFrom),
    totalsByMetric(ctx, period.from, period.to),
    listCategories(ctx, now),
    db
      .select({ location: household.location })
      .from(household)
      .where(eq(household.id, ctx.householdId)),
    periodCoverage(ctx, period, today),
    modules.battery ? batteryMonths(ctx, period.from, period.to) : [],
    listMarkers(ctx, yearFrom, yearTo),
    listEquipment(ctx),
    modules.solar
      ? solarMonths(ctx, previousYearFrom, yearTo)
      : new Map<string, Record<string, number>>(),
    ctx.granularity === "hourly" ? nightHours(ctx, previousYearFrom, yearTo) : null,
  ]);
  const { calendars } = await pricingDays(ctx.householdId, addDays(previousYearFrom, -1), yearTo);
  const pricing = { timezone: tz, ...calendars };
  const price = (list: PriceableInterval[], from: string, to: string): TimelineResult =>
    priceTimeline(list, buildTimeline(contracts, from, to, today), pricing);

  // Coût de l'année (barres mensuelles) puis de la période. Sans contrat souscrit ni
  // contrat actuel, la frise n'a aucune grille : l'électricité n'est pas chiffrée.
  const priced = buildTimeline(contracts, yearFrom, yearTo, today).some((s) => s.contract);
  const yearCost = price(intervals, yearFrom, yearTo);
  const dayOf = (i: PriceableInterval) =>
    i.granularity === "hour" ? localParts(i.start, tz).date : i.date;
  const inPeriod = intervals.filter((i) => dayOf(i) >= period.from && dayOf(i) < period.to);
  const periodCost = period.kind === "year" ? yearCost : price(inPeriod, period.from, period.to);
  // kWh soutirés par mois, chiffrés ou non (sans contrat, le coût reste vide, pas l'énergie).
  const kwhByMonth = new Map<string, number>();
  for (const i of [...intervals, ...previousYearIntervals]) {
    const month = dayOf(i).slice(0, 7);
    kwhByMonth.set(month, (kwhByMonth.get(month) ?? 0) + i.kwh);
  }
  const previousIntervals = previousYearIntervals.filter(
    (i) => dayOf(i) >= previous.from && dayOf(i) < previous.to,
  );
  const previousCost =
    previousIntervals.length > 0 ? price(previousIntervals, previous.from, previous.to) : null;
  const previousYearCost = price(previousYearIntervals, previousYearFrom, yearFrom);

  /** Chiffres d'un mois « AAAA-MM » de l'année de la période ou de la précédente. */
  const figuresOf = (
    key: string,
    cost: TimelineResult["byMonth"][string] | undefined,
  ): MonthFigures => {
    const slots = slotHpHc(cost?.slotKwh ?? {});
    const solar = solarByMonth.get(key) ?? {};
    const pricedKwh = cost?.kwh ?? 0;
    return {
      energyCents: cost?.energyCents ?? 0,
      subscriptionCents: cost?.subscriptionCents ?? 0,
      kwh: kwhByMonth.get(key) ?? 0,
      hpKwh: slots.hp,
      hcKwh: slots.hc,
      solarKwh: solar.solar_production ?? 0,
      solarSavingCents: modules.solar
        ? solarSavingEstimate(
            {
              solar: solar.solar_production ?? 0,
              gridExport: solar.grid_export ?? 0,
              batteryCharge: solar.battery_charge ?? 0,
              batteryChargeGrid: solar.battery_charge_grid ?? 0,
            },
            {
              avgPriceCents: priced && pricedKwh > 0 ? (cost?.energyCents ?? 0) / pricedKwh : null,
              gridCharging: ctx.settings.batteryGridCharging,
              exportPriceCents: ctx.settings.exportEnabled
                ? ctx.settings.exportPriceEurKwh * 100
                : null,
            },
          )
        : null,
    };
  };
  const previousMonth = (key: string): MonthCost["previous"] => {
    const k = `${Number(key.slice(0, 4)) - 1}${key.slice(4)}`;
    if (!kwhByMonth.has(k) && !solarByMonth.has(k)) return null;
    return figuresOf(k, previousYearCost.byMonth[k]);
  };
  const peakOf = () => {
    const id = currentContract(contracts, today)?.id;
    const kind = contracts.find((c) => c.id === id)?.kind;
    if (kind !== "hphc" && kind !== "tempo") return null;
    const split = peakSplit(periodCost.bySlot);
    return split && { ...split, approximated: periodCost.approximatedKwh > 0 };
  };
  const balance = energyBalance(totals, { batteryGridCharging: ctx.settings.batteryGridCharging });

  let solar: Extract<Overview, { status: "ok" }>["solar"] = null;
  if (modules.solar) {
    const location = home[0]?.location ?? null;
    const cell = location ? cellOf(location) : null;
    const byMonth = period.kind === "year";
    const [current, before] = await Promise.all([
      solarSeries(ctx, period.from, period.to, byMonth, cell),
      solarSeries(ctx, previous.from, previous.to, byMonth, cell),
    ]);
    const keys = period.kind === "year" ? yearMonths(year, today) : eachDay(period.from, period.to);
    const kwhOf = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    const previousKwh = kwhOf(before.kwhByKey);
    solar = {
      points: keys.map((key) => ({
        key,
        kwh: current.kwhByKey.get(key) ?? 0,
        sunshineHours: current.sunshine.get(key) ?? null,
        previousKwh: before.kwhByKey.get(shiftYear(key, -1)) ?? null,
      })),
      kwh: balance.solar,
      yield: solarYield(balance.solar, current.radiation),
      previousYield: previousKwh > 0 ? solarYield(previousKwh, before.radiation) : null,
      noLocation: cell === null,
    };
  }

  // Projection : seulement pour l'année en cours, quand l'électricité est chiffrée.
  const thisMonth = today.slice(0, 7);
  const projection =
    priced && year === today.slice(0, 4)
      ? projectYear(
          Array.from({ length: 12 }, (_, i) => {
            const key = `${year}-${String(i + 1).padStart(2, "0")}`;
            const cost = yearCost.byMonth[key];
            const prevKey = `${Number(year) - 1}${key.slice(4)}`;
            const prev = previousYearCost.byMonth[prevKey];
            return {
              key,
              actualCents:
                key <= thisMonth ? (cost?.energyCents ?? 0) + (cost?.subscriptionCents ?? 0) : null,
              previousCents:
                kwhByMonth.has(prevKey) && prev ? prev.energyCents + prev.subscriptionCents : null,
            };
          }),
          {
            key: thisMonth,
            elapsedDays: Number(today.slice(8, 10)),
            daysInMonth: eachDay(`${thisMonth}-01`, `${nextMonth(thisMonth)}-01`).length,
          },
        )
      : null;

  let baseload: Extract<Overview, { status: "ok" }>["baseload"] = null;
  if (nights) {
    const minima = nightlyMinima(nights);
    // Dernier jour de la période (fin exclue), sans dépasser aujourd'hui.
    const lastDay = [addDays(period.to, -1), today].sort()[0] as string;
    baseload = {
      watts: baseloadBetween(minima, period.from, period.to)?.watts ?? null,
      previousWatts: baseloadBetween(minima, previous.from, previous.to)?.watts ?? null,
      months: baseloadMonths(minima, monthsEndingAt(lastDay.slice(0, 7), 12)),
      centsPerKwh: priced && yearCost.kwh > 0 ? yearCost.energyCents / yearCost.kwh : null,
    };
  }

  return {
    status: "ok",
    period,
    nav: periodNav(period, firstDay, today),
    granularity: ctx.granularity,
    coverage,
    budget: {
      totalCents: priced ? periodCost.totalCents : null,
      energyCents: periodCost.energyCents,
      subscriptionCents: periodCost.subscriptionCents,
      previousCents: priced && previousCost ? previousCost.totalCents : null,
      unknownContractDays: periodCost.unknownContractDays,
    },
    months: yearMonths(year, today).map((key) => ({
      key,
      ...figuresOf(key, yearCost.byMonth[key]),
      previous: previousMonth(key),
    })),
    batteryGaps: batteryGaps(battery),
    peak: peakOf(),
    markers: markersBetween(
      [...savedMarkers, ...autoMarkers(contracts, equipment)],
      yearFrom,
      yearTo,
    ),
    balance,
    projection,
    baseload,
    categories: categories
      .filter((c) => modules.heatingCategories || !c.isHeating)
      .map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        color: c.color,
        isHeating: c.isHeating,
        kwh: totals[`category:${c.slug}`] ?? 0,
      })),
    solar,
  };
}
