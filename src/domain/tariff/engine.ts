import { daysInYear, eachDay, localParts } from "@/lib/time";
import { basePricer, hphcPricer } from "./base-hphc";
import { customPricer } from "./custom";
import { spotPricer } from "./spot";
import { tempoPricer } from "./tempo";
import type { Pricer } from "./pricer";
import type {
  Contract,
  DayBreakdown,
  MonthBreakdown,
  PriceableInterval,
  PricedResult,
  PricingContext,
} from "./types";

// Les montants sont cumulés en euros exacts puis arrondis au centime une seule fois,
// à la sortie : arrondir chaque heure ferait dériver le total de plusieurs centimes par an.

function pricerFor(contract: Contract, ctx: PricingContext): Pricer {
  switch (contract.kind) {
    case "base":
      return basePricer(contract);
    case "hphc":
      return hphcPricer(contract);
    case "tempo":
      return tempoPricer(contract, ctx);
    case "custom":
      return customPricer(contract, ctx);
    case "spot":
      return spotPricer(contract, ctx);
  }
}

interface Acc {
  energyEur: number;
  subscriptionEur: number;
  kwh: number;
  slotKwh: Record<string, number>;
}

const cents = (eur: number) => Math.round(eur * 100);

export function priceIntervals(
  intervals: readonly PriceableInterval[],
  contract: Contract,
  ctx: PricingContext,
): PricedResult {
  const pricer = pricerFor(contract, ctx);
  const months = new Map<string, Acc>();
  const days = new Map<string, { energyEur: number; subscriptionEur: number; kwh: number }>();
  const slots = new Map<string, { kwh: number; eur: number }>();
  let approximatedKwh = 0;

  const month = (key: string) => {
    let m = months.get(key);
    if (!m) months.set(key, (m = { energyEur: 0, subscriptionEur: 0, kwh: 0, slotKwh: {} }));
    return m;
  };
  const dayAcc = (key: string) => {
    let d = days.get(key);
    if (!d) days.set(key, (d = { energyEur: 0, subscriptionEur: 0, kwh: 0 }));
    return d;
  };

  for (const interval of intervals) {
    let date: string;
    let shares;
    if (interval.granularity === "hour") {
      const local = localParts(interval.start, ctx.timezone);
      date = local.date;
      shares = pricer.hour(local, interval.start);
    } else {
      date = interval.date;
      const priced = pricer.day(interval.date, interval.slot);
      shares = priced.shares;
      if (priced.approximated) approximatedKwh += interval.kwh;
    }

    const m = month(date.slice(0, 7));
    const d = dayAcc(date);
    m.kwh += interval.kwh;
    d.kwh += interval.kwh;
    for (const share of shares) {
      const kwh = interval.kwh * share.fraction;
      const eur = kwh * share.price;
      m.energyEur += eur;
      d.energyEur += eur;
      m.slotKwh[share.key] = (m.slotKwh[share.key] ?? 0) + kwh;
      const s = slots.get(share.key) ?? { kwh: 0, eur: 0 };
      s.kwh += kwh;
      s.eur += eur;
      slots.set(share.key, s);
    }
  }

  for (const day of eachDay(ctx.period.from, ctx.period.to)) {
    const share = contract.subscriptionEurYear / daysInYear(Number(day.slice(0, 4)));
    month(day.slice(0, 7)).subscriptionEur += share;
    dayAcc(day).subscriptionEur += share;
  }

  let energyEur = 0;
  let subscriptionEur = 0;
  let kwh = 0;
  const byMonth: Record<string, MonthBreakdown> = {};
  for (const key of [...months.keys()].sort()) {
    const m = months.get(key) as Acc;
    energyEur += m.energyEur;
    subscriptionEur += m.subscriptionEur;
    kwh += m.kwh;
    byMonth[key] = {
      energyCents: cents(m.energyEur),
      subscriptionCents: cents(m.subscriptionEur),
      kwh: m.kwh,
      slotKwh: m.slotKwh,
    };
  }

  const byDay: Record<string, DayBreakdown> = {};
  for (const [key, d] of days) {
    byDay[key] = {
      energyCents: cents(d.energyEur),
      subscriptionCents: cents(d.subscriptionEur),
      kwh: d.kwh,
    };
  }

  const bySlot: PricedResult["bySlot"] = {};
  for (const [key, s] of slots) bySlot[key] = { kwh: s.kwh, energyCents: cents(s.eur) };

  const energyCents = cents(energyEur);
  const subscriptionCents = cents(subscriptionEur);
  return {
    totalCents: energyCents + subscriptionCents,
    energyCents,
    subscriptionCents,
    kwh,
    byMonth,
    byDay,
    bySlot,
    approximatedKwh,
    assumedTempoDays: pricer.assumedDays?.() ?? 0,
    assumedSpotHours: pricer.assumedHours?.() ?? 0,
  };
}
