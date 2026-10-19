import { and, asc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { energyInterval } from "@/db/schema";
import { compareContracts, type ComparedContract } from "@/domain/tariff/compare";
import { analyzePayment, type MonthlyPayment, type PaymentAnalysis } from "@/domain/tariff/payment";
import {
  buildTimeline,
  currentContract,
  latestGrid,
  priceTimeline,
} from "@/domain/tariff/timeline";
import type {
  Contract,
  PriceableInterval,
  PricingContext,
  TempoColor,
} from "@/domain/tariff/types";
import { addDays, eachDay, localParts, zonedInstant } from "@/lib/time";
import type { HouseholdContext } from "../context";
import { listContracts, type ContractWithPeriods } from "../contracts";
import { shareInFlight } from "../inflight";
import { pricingDays } from "../calendars";

// Comparaison des contrats sur la consommation réelle (T18) : 12 derniers mois, ou depuis
// la première donnée si l'historique est plus court (coût alors annualisé).

export const MIN_DAYS = 7;

export type ContractComparison =
  | { status: "no-data" }
  | { status: "insufficient"; days: number }
  | {
      status: "ok";
      from: string;
      to: string;
      periodDays: number;
      kwh: number;
      /** Part des heures (horaire) ou des jours (quotidien) effectivement reçus, 0–1. */
      coverage: number;
      granularity: "hourly" | "daily";
      redDays: number;
      rows: ComparedContract[];
      /** Coût réellement payé sur la période (contrat et grille en vigueur chaque jour). */
      real: { totalCents: number; annualCents: number; unknownContractDays: number } | null;
    };

/** Consommation des 12 derniers mois et contexte de calcul, partagés par les comparaisons. */
export type ComparisonInputs =
  | { status: "no-data" }
  | { status: "insufficient"; days: number }
  | {
      status: "ok";
      from: string;
      today: string;
      periodDays: number;
      intervals: PriceableInterval[];
      colors: Map<string, TempoColor>;
      sobriety: Set<string>;
      /** Heures de prix spot connues sur la période (T58). */
      spotHours: number;
      pricing: PricingContext;
      contracts: ContractWithPeriods[];
      /** Grille actuelle du contrat en cours ; null sans contrat en cours. */
      current: { id: string; contract: Contract } | null;
    };

async function loadInputs(ctx: HouseholdContext, now: Date): Promise<ComparisonInputs> {
  const tz = ctx.timezone;
  const today = localParts(now, tz).date;
  const windowFrom = addDays(today, -365);
  const where = and(
    eq(energyInterval.householdId, ctx.householdId),
    eq(energyInterval.metric, "grid_import"),
    gte(energyInterval.start, zonedInstant(windowFrom, 0, tz)),
    lt(energyInterval.start, zonedInstant(today, 0, tz)),
  );
  const rows = await db
    .select({
      start: energyInterval.start,
      granularity: energyInterval.granularity,
      tariffSlot: energyInterval.tariffSlot,
      kwh: energyInterval.kwh,
    })
    .from(energyInterval)
    .where(where)
    .orderBy(asc(energyInterval.start));
  const first = rows[0];
  if (!first) return { status: "no-data" };

  const from = localParts(first.start, tz).date;
  const periodDays = eachDay(from, today).length;
  if (periodDays < MIN_DAYS) return { status: "insufficient", days: periodDays };

  const intervals: PriceableInterval[] = rows.map((r) =>
    r.granularity === "hour"
      ? { granularity: "hour", start: r.start, kwh: r.kwh }
      : {
          granularity: "day",
          date: localParts(r.start, tz).date,
          slot: r.tariffSlot === "all" ? null : r.tariffSlot,
          kwh: r.kwh,
        },
  );

  // La veille de la période est incluse : ses heures de 0 h à 6 h sont du jour Tempo précédent.
  const { colors, sobriety, spotHours, calendars } = await pricingDays(
    ctx.householdId,
    addDays(from, -1),
    today,
    { timezone: ctx.timezone, spot: true },
  );
  const contracts = await listContracts(ctx);
  const current = currentContract(contracts, today);
  return {
    status: "ok",
    from,
    today,
    periodDays,
    intervals,
    colors,
    sobriety,
    spotHours,
    pricing: { timezone: tz, period: { from, to: today }, ...calendars },
    contracts,
    current: current ? { id: current.id, contract: latestGrid(current) } : null,
  };
}

/**
 * Entrées des comparaisons (contrats du foyer, offres du marché) : la page Contrats calcule
 * les deux à la fois, une seule lecture de la consommation sert aux deux.
 */
export function comparisonInputs(ctx: HouseholdContext, now = new Date()) {
  return shareInFlight(`comparison-inputs:${ctx.householdId}`, () => loadInputs(ctx, now));
}

export async function getContractComparison(
  ctx: HouseholdContext,
  now = new Date(),
): Promise<ContractComparison> {
  const inputs = await comparisonInputs(ctx, now);
  if (inputs.status !== "ok") return inputs;
  const { from, today, periodDays, intervals, colors, contracts, current } = inputs;
  // Chaque offre est simulée avec sa grille actuelle : ce qu'elle coûterait aujourd'hui.
  const compared = compareContracts(
    contracts.map((c) => ({
      id: c.id,
      name: c.name,
      isCurrent: c.id === current?.id,
      contract: latestGrid(c),
    })),
    intervals,
    inputs.pricing,
    periodDays,
  );

  // Coût réel : contrat souscrit et grille en vigueur à chaque date.
  const hasSubscribed = contracts.some((c) => c.status === "subscribed");
  const timeline = hasSubscribed
    ? priceTimeline(intervals, buildTimeline(contracts, from, today, today), inputs.pricing)
    : null;
  const real = timeline
    ? {
        totalCents: timeline.totalCents,
        annualCents: Math.round((timeline.totalCents * 365) / periodDays),
        unknownContractDays: timeline.unknownContractDays,
      }
    : null;

  // Couverture : heures reçues (mode horaire) ou jours reçus (mode quotidien).
  const hours = intervals.filter((i) => i.granularity === "hour").length;
  const days = new Set(intervals.flatMap((i) => (i.granularity === "day" ? [i.date] : []))).size;
  const coverage = ctx.granularity === "hourly" ? hours / (periodDays * 24) : days / periodDays;
  const redDays = eachDay(from, today).filter((d) => colors.get(d) === "rouge").length;

  return {
    status: "ok",
    from,
    to: today,
    periodDays,
    kwh: intervals.reduce((a, i) => a + i.kwh, 0),
    coverage: Math.min(1, coverage),
    granularity: ctx.granularity,
    redDays,
    rows: compared,
    real,
  };
}

/**
 * Mensualité du contrat en cours (T59, SPEC §7.13) : null sans contrat en cours ou sans
 * mensualité renseignée. Même consommation que la comparaison des contrats ; moins de 7 jours
 * de données comptent comme un historique insuffisant.
 */
export async function getPaymentAnalysis(
  ctx: HouseholdContext,
  now = new Date(),
): Promise<{ contractId: string; payment: MonthlyPayment; analysis: PaymentAnalysis } | null> {
  const inputs = await comparisonInputs(ctx, now);
  if (inputs.status === "no-data") return null;
  const contracts = inputs.status === "ok" ? inputs.contracts : await listContracts(ctx);
  const today = localParts(now, ctx.timezone).date;
  const currentId = currentContract(contracts, today)?.id;
  const current = contracts.find((c) => c.id === currentId);
  if (!current?.payment) return null;
  const ok = inputs.status === "ok" ? inputs : null;
  return {
    contractId: current.id,
    payment: current.payment,
    analysis: analyzePayment({
      payment: current.payment,
      today,
      from: ok?.from ?? today,
      periodDays: ok?.periodDays ?? (inputs.status === "insufficient" ? inputs.days : 0),
      intervals: ok?.intervals ?? [],
      contracts,
      current: { contract: latestGrid(current), startDate: current.startDate },
      pricing: ok?.pricing ?? { timezone: ctx.timezone },
    }),
  };
}
