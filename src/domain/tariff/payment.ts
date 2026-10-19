import { z } from "zod";
import { eachDay, localParts } from "@/lib/time";
import { priceIntervals } from "./engine";
import { buildTimeline, priceTimeline, type DatedContract } from "./timeline";
import type { Contract, PriceableInterval, PricingContext } from "./types";

// Mensualité du contrat (T59, SPEC §7.13) : le prélevé sur un an face au coût attendu sur un
// an (12 derniers mois de consommation au prix actuel). Juger sur l'année entière intègre
// l'hiver : en avance l'été, en retard l'hiver, sans que la mensualité soit fausse. Pur.

export const PAYMENTS_PER_YEAR = [12, 11, 10] as const;
export type PaymentsPerYear = (typeof PAYMENTS_PER_YEAR)[number];

export interface MonthlyPayment {
  amountCents: number;
  paymentsPerYear: PaymentsPerYear;
  /** Mois (1–12) de la facture de régularisation ; null : inconnu. */
  settlementMonth: number | null;
}

const inputSchema = z.object({
  amount: z
    .union([z.string(), z.number()])
    // « 1 200,50 » : séparateurs de milliers (espaces, insécables compris) retirés.
    .transform((v) =>
      Math.round(
        Number(
          String(v)
            .replace(/[\s\u00a0\u202f]/g, "")
            .replace(",", "."),
        ) * 100,
      ),
    )
    .refine((c) => Number.isFinite(c) && c >= 100 && c <= 200_000, "mensualité entre 1 et 2 000 €"),
  paymentsPerYear: z.union([z.literal(12), z.literal(11), z.literal(10)], {
    error: "10, 11 ou 12 prélèvements par an",
  }),
  settlementMonth: z
    .number({ error: "mois de régularisation invalide" })
    .int("mois de régularisation invalide")
    .min(1, "mois de régularisation invalide")
    .max(12, "mois de régularisation invalide")
    .nullable(),
});

/** Saisie de la carte du contrat (montant en euros), messages en français. */
export function parseMonthlyPayment(
  raw: unknown,
): { ok: true; value: MonthlyPayment } | { ok: false; errors: string[] } {
  const r = inputSchema.safeParse(raw);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => i.message) };
  return {
    ok: true,
    value: {
      amountCents: r.data.amount,
      paymentsPerYear: r.data.paymentsPerYear,
      settlementMonth: r.data.settlementMonth,
    },
  };
}

/** Jours de données nécessaires pour un verdict (une année, à une semaine près). */
export const PAYMENT_MIN_DAYS = 358;
/** Part minimale des jours reçus sur la période pour un verdict (T62). */
export const PAYMENT_MIN_COVERAGE = 0.9;
/** Écart toléré entre prélevé et attendu sur l'année. */
export const PAYMENT_TOLERANCE = 0.05;
/** Écart au-delà duquel la Vue d'ensemble le signale. */
export const PAYMENT_NOTICE_GAP = 0.1;

export type PaymentAnalysis =
  | { status: "insufficient"; months: number }
  /** Trop de jours sans donnée (ou aucun coût attendu) : part des jours reçus, 0–1. */
  | { status: "incomplete"; coverage: number }
  | {
      status: "ok";
      verdict: "ok" | "high" | "low";
      paidAnnualCents: number;
      expectedAnnualCents: number;
      /** (prélevé − attendu) ÷ attendu. */
      gap: number;
      /** Coût attendu ÷ prélèvements, arrondi à l'euro supérieur. */
      advisedCents: number;
      /** Mois connu : solde estimé de la régularisation (> 0 : à payer, < 0 : en votre faveur). */
      settlement: { month: string; balanceCents: number } | null;
    };

const shiftYear = (day: string, years: number) =>
  `${Number(day.slice(0, 4)) + years}${day.slice(4)}`.replace(/-02-29$/, "-02-28");
const firstOfMonth = (year: number, month: number) =>
  `${year + Math.floor((month - 1) / 12)}-${String(((month - 1) % 12) + 1).padStart(2, "0")}-01`;

/**
 * Année de facturation en cours : elle se termine à la fin du mois de régularisation à venir
 * (ce mois-ci compris), et commence douze mois plus tôt. Jours [from, to).
 */
export function billingYear(today: string, settlementMonth: number) {
  const year = Number(today.slice(0, 4));
  const settlementYear = Number(today.slice(5, 7)) <= settlementMonth ? year : year + 1;
  const to = firstOfMonth(settlementYear, settlementMonth + 1);
  return {
    from: shiftYear(to, -1),
    to,
    settlement: `${settlementYear}-${String(settlementMonth).padStart(2, "0")}`,
  };
}

export function analyzePayment(input: {
  payment: MonthlyPayment;
  /** Jour local du foyer. */
  today: string;
  /** Premier jour des données retenues (12 derniers mois au plus) et leur nombre de jours. */
  from: string;
  periodDays: number;
  /** Soutirage au réseau de [from, today). */
  intervals: readonly PriceableInterval[];
  /** Contrats du foyer (coût réel jour par jour). */
  contracts: readonly DatedContract[];
  /** Contrat en cours : grille actuelle et date de souscription. */
  current: { contract: Contract; startDate: string | null };
  pricing: Pick<
    PricingContext,
    "timezone" | "tempoColor" | "sobrietyDay" | "spotPrice" | "spotFallback"
  >;
}): PaymentAnalysis {
  const { payment, today, periodDays, pricing } = input;
  if (periodDays < PAYMENT_MIN_DAYS) {
    return { status: "insufficient", months: Math.min(11, Math.round(periodDays / 30.44)) };
  }
  const dayOf = (i: PriceableInterval) =>
    i.granularity === "hour" ? localParts(i.start, pricing.timezone).date : i.date;
  const between = (from: string, to: string) =>
    input.intervals.filter((i) => dayOf(i) >= from && dayOf(i) < to);
  const priced = (from: string, to: string) =>
    priceIntervals(between(from, to), input.current.contract, {
      ...pricing,
      period: { from, to },
    });
  const atCurrentPrice = (from: string, to: string) => priced(from, to).totalCents;

  // Jours reçus : heures ÷ 24 en envoi horaire, jours distincts en envoi quotidien.
  const hours = input.intervals.filter((i) => i.granularity === "hour").length;
  const dailyDays = new Set(
    input.intervals.flatMap((i) => (i.granularity === "day" ? [i.date] : [])),
  );
  const covered = Math.min(periodDays, hours / 24 + dailyDays.size);
  const coverage = covered / periodDays;
  // L'énergie est ramenée à un an sur les jours reçus ; l'abonnement court toute l'année.
  const past = priced(input.from, today);
  const expectedAnnualCents =
    covered > 0
      ? Math.round((past.energyCents * 365) / covered) +
        Math.round((past.subscriptionCents * 365) / periodDays)
      : 0;
  if (coverage < PAYMENT_MIN_COVERAGE || expectedAnnualCents <= 0) {
    return { status: "incomplete", coverage };
  }
  const paidAnnualCents = payment.amountCents * payment.paymentsPerYear;
  const gap = expectedAnnualCents > 0 ? paidAnnualCents / expectedAnnualCents - 1 : 0;
  const verdict =
    Math.abs(gap) <= PAYMENT_TOLERANCE ? "ok" : gap > 0 ? ("high" as const) : ("low" as const);

  let settlement: { month: string; balanceCents: number } | null = null;
  if (payment.settlementMonth !== null) {
    const year = billingYear(today, payment.settlementMonth);
    // Contrat souscrit en cours d'année : sa facturation commence à la souscription.
    const start = [year.from, input.current.startDate ?? year.from].sort().at(-1) as string;
    const real = priceTimeline(
      between(start, today),
      buildTimeline(input.contracts, start, today, today),
      pricing,
    ).totalCents;
    // Jours restants : les mêmes jours un an plus tôt, au prix actuel.
    const rest = atCurrentPrice(shiftYear(today, -1), shiftYear(year.to, -1));
    const share = eachDay(start, year.to).length / eachDay(year.from, year.to).length;
    settlement = {
      month: year.settlement,
      balanceCents: real + rest - Math.round(paidAnnualCents * share),
    };
  }

  return {
    status: "ok",
    verdict,
    paidAnnualCents,
    expectedAnnualCents,
    gap,
    advisedCents: Math.ceil(expectedAnnualCents / payment.paymentsPerYear / 100) * 100,
    settlement,
  };
}
