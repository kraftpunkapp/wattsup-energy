import { localParts } from "@/lib/time";

// Coût d'un kWh de plus, heure par heure, et meilleur créneau de chaque appareil déplaçable
// (T70, SPEC §7.14). Le surplus solaire prévu (après la batterie) est consommé d'abord, au
// prix de revente perdu (0 sans revente) ; le reste est acheté au prix du contrat à cette
// heure. Départs au quart d'heure ; à coût égal, le plus tôt. Pur.

const QUARTER_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;

export interface Appliance {
  id: string;
  name: string;
  powerKw: number;
  durationMin: number;
  /** Plage permise, heures locales [from, to) ; from = to : toute la journée ; peut passer minuit. */
  allowedFrom: number;
  allowedTo: number;
}

export interface CostHour {
  start: Date;
  /** Prix du kWh acheté à cette heure (€). */
  priceEurKwh: number;
  /** Surplus prévu, après la batterie (kWh). */
  surplusKwh: number;
}

export interface PricedHour extends CostHour {
  /** Coût d'un kWh de plus consommé à cette heure (€). */
  kwhCostEur: number;
}

/** Coût d'un kWh de plus à chaque heure, d'après le surplus prévu et le prix de l'heure. */
export function marginalCosts(
  hours: readonly { start: Date; exportKwh: number }[],
  prices: readonly number[],
  exportPriceEur: number,
): PricedHour[] {
  return hours.map((h, i) => {
    const price = prices[i] ?? 0;
    const fromSurplus = Math.min(1, h.exportKwh);
    return {
      start: h.start,
      priceEurKwh: price,
      surplusKwh: h.exportKwh,
      kwhCostEur: fromSurplus * exportPriceEur + (1 - fromSurplus) * price,
    };
  });
}

const allowed = (a: Appliance, minuteOfDay: number) => {
  const from = a.allowedFrom * 60;
  const to = a.allowedTo * 60;
  if (from === to) return true;
  return from < to
    ? minuteOfDay >= from && minuteOfDay < to
    : minuteOfDay >= from || minuteOfDay < to;
};

export interface Window {
  start: Date;
  end: Date;
  costEur: number;
  /** Part de l'énergie de l'appareil couverte par le surplus solaire, 0–1. */
  solarShare: number;
  /** Coût si l'appareil part au premier moment permis. */
  nowCostEur: number;
}

/** Meilleur créneau de l'appareil dans les heures données, à partir de `notBefore` ; null sinon. */
export function bestWindow(
  hours: readonly CostHour[],
  appliance: Appliance,
  timezone: string,
  notBefore: Date,
  exportPriceEur: number,
): Window | null {
  if (hours.length === 0 || appliance.durationMin <= 0) return null;
  const byHour = new Map(hours.map((h) => [h.start.getTime(), h]));
  const first = (hours[0] as CostHour).start.getTime();
  const end = (hours.at(-1) as CostHour).start.getTime() + HOUR_MS;
  const quarters = Math.ceil(appliance.durationMin / 15);
  const energy = (appliance.powerKw * 15) / 60; // kWh par quart d'heure

  const evaluate = (start: number) => {
    let cost = 0;
    let solar = 0;
    for (let q = 0; q < quarters; q++) {
      const t = start + q * QUARTER_MS;
      // Heures alignées sur l'heure UTC pleine, comme les relevés.
      const hour = byHour.get(t - (t % HOUR_MS));
      const p = localParts(new Date(t), timezone);
      if (!hour || !allowed(appliance, p.hour * 60 + p.minute)) return null;
      const fromSurplus = Math.min(energy, hour.surplusKwh / 4);
      solar += fromSurplus;
      cost += fromSurplus * exportPriceEur + (energy - fromSurplus) * hour.priceEurKwh;
    }
    return { cost, solar };
  };

  let best: { start: number; cost: number; solar: number } | null = null;
  let firstValid: number | null = null;
  const from = Math.max(first, Math.ceil(notBefore.getTime() / QUARTER_MS) * QUARTER_MS);
  for (let s = from; s + quarters * QUARTER_MS <= end; s += QUARTER_MS) {
    const r = evaluate(s);
    if (!r) continue;
    firstValid ??= r.cost;
    // Marge d'un millième de centime : deux départs au même coût, le plus tôt l'emporte.
    if (!best || r.cost < best.cost - 1e-9) best = { start: s, ...r };
  }
  if (!best || firstValid === null) return null;
  const total = energy * quarters;
  return {
    start: new Date(best.start),
    end: new Date(best.start + quarters * QUARTER_MS),
    costEur: best.cost,
    solarShare: total > 0 ? best.solar / total : 0,
    nowCostEur: firstValid,
  };
}
