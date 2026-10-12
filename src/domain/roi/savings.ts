import { priceIntervals } from "../tariff/engine";
import type { Contract, PriceableInterval, TempoColor } from "../tariff/types";

// Rentabilité du solaire et de la batterie (SPEC §7.2–7.3, T29). Pur. Le kWh évité est
// valorisé par le moteur tarifaire au créneau de chaque intervalle, sur le contrat actuel.

/** Énergie d'un intervalle (heure, ou jour en envoi quotidien), en kWh. */
export interface EnergySlot {
  interval: { granularity: "hour"; start: Date } | { granularity: "day"; date: string };
  solar: number;
  gridExport: number;
  batteryCharge: number;
  /** Part de la charge venue du réseau (0 si la batterie ne se charge pas sur le réseau). */
  batteryChargeGrid: number;
  batteryDischarge: number;
}

export interface SavingsOptions {
  /** Contrat actuel (sa grille actuelle) ; null : rien à valoriser. */
  contract: Contract | null;
  timezone: string;
  tempoColor?: (day: string) => TempoColor | undefined;
  /** Jours de sobriété Zen Flex (T57). */
  sobrietyDay?: (day: string) => boolean;
  exportEnabled: boolean;
  exportPriceEurKwh: number;
  batteryGridCharging: boolean;
}

export interface Savings {
  totalCents: number;
  /** Détail : « avoided » (kWh évités), « export » (revente), « gridCharge » (charge réseau, ≤ 0), « lostExport » (revente perdue, ≤ 0). */
  parts: { avoided: number; export: number; gridCharge: number; lostExport: number };
  kwh: { avoided: number; exported: number; gridCharge: number };
  /** Économie par mois local « AAAA-MM », en centimes. */
  byMonth: Record<string, number>;
}

const at = (s: EnergySlot, kwh: number): PriceableInterval =>
  s.interval.granularity === "hour"
    ? { granularity: "hour", start: s.interval.start, kwh }
    : { granularity: "day", date: s.interval.date, slot: null, kwh };

// Un formateur par fuseau : en créer un par intervalle coûte cher (17 520 heures par an).
const monthFormatters = new Map<string, Intl.DateTimeFormat>();
const monthOf = (s: EnergySlot, timezone: string) => {
  if (s.interval.granularity === "day") return s.interval.date.slice(0, 7);
  let f = monthFormatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" });
    monthFormatters.set(timezone, f);
  }
  return f.format(s.interval.start).slice(0, 7);
};

const chargeFromGrid = (s: EnergySlot, o: SavingsOptions) =>
  o.batteryGridCharging ? Math.min(s.batteryCharge, s.batteryChargeGrid) : 0;

/** Énergie valorisée au prix du contrat, en centimes, au total et par mois. */
function valued(slots: readonly EnergySlot[], kwh: (s: EnergySlot) => number, o: SavingsOptions) {
  if (!o.contract) return { cents: 0, byMonth: {} as Record<string, number>, kwh: 0 };
  const list = slots.map((s) => at(s, Math.max(0, kwh(s)))).filter((i) => i.kwh > 0);
  const r = priceIntervals(list, o.contract, {
    timezone: o.timezone,
    // L'abonnement n'est pas une économie : seule l'énergie compte.
    period: { from: "2000-01-01", to: "2000-01-01" },
    tempoColor: o.tempoColor,
    sobrietyDay: o.sobrietyDay,
  });
  return {
    cents: r.energyCents,
    byMonth: Object.fromEntries(Object.entries(r.byMonth).map(([k, m]) => [k, m.energyCents])),
    kwh: r.kwh,
  };
}

/** Montant à prix fixe (revente), en centimes, au total et par mois. */
function atFixedPrice(
  slots: readonly EnergySlot[],
  kwh: (s: EnergySlot) => number,
  price: number,
  tz: string,
) {
  const byMonth: Record<string, number> = {};
  let total = 0;
  let energy = 0;
  for (const s of slots) {
    const k = Math.max(0, kwh(s));
    energy += k;
    total += k * price * 100;
    const m = monthOf(s, tz);
    byMonth[m] = (byMonth[m] ?? 0) + k * price * 100;
  }
  return { cents: Math.round(total), byMonth, kwh: energy };
}

function combine(parts: { sign: 1 | -1; byMonth: Record<string, number> }[]) {
  const byMonth: Record<string, number> = {};
  for (const p of parts) {
    for (const [m, c] of Object.entries(p.byMonth)) byMonth[m] = (byMonth[m] ?? 0) + p.sign * c;
  }
  // `|| 0` : pas de « −0 » quand les parts s'annulent.
  return Object.fromEntries(Object.entries(byMonth).map(([m, c]) => [m, Math.round(c) || 0]));
}

/**
 * Solaire : autoconsommation directe (production − export − charge solaire de la
 * batterie) au prix du kWh évité, plus l'export au prix de revente si elle est activée.
 */
export function solarSavings(slots: readonly EnergySlot[], o: SavingsOptions): Savings {
  const direct = valued(
    slots,
    (s) => s.solar - s.gridExport - (s.batteryCharge - chargeFromGrid(s, o)),
    o,
  );
  const exported = o.exportEnabled
    ? atFixedPrice(slots, (s) => s.gridExport, o.exportPriceEurKwh, o.timezone)
    : { cents: 0, byMonth: {}, kwh: slots.reduce((a, s) => a + s.gridExport, 0) };
  return {
    totalCents: direct.cents + exported.cents,
    parts: { avoided: direct.cents, export: exported.cents, gridCharge: 0, lostExport: 0 },
    kwh: { avoided: direct.kwh, exported: exported.kwh, gridCharge: 0 },
    byMonth: combine([
      { sign: 1, byMonth: direct.byMonth },
      { sign: 1, byMonth: exported.byMonth },
    ]),
  };
}

/**
 * Batterie : décharge au prix du kWh évité, moins la charge venue du réseau au prix du
 * créneau de charge, moins la revente perdue sur la charge solaire (si revente).
 */
export function batterySavings(slots: readonly EnergySlot[], o: SavingsOptions): Savings {
  const discharge = valued(slots, (s) => s.batteryDischarge, o);
  const gridCharge = o.batteryGridCharging
    ? valued(slots, (s) => chargeFromGrid(s, o), o)
    : { cents: 0, byMonth: {}, kwh: 0 };
  const lost = o.exportEnabled
    ? atFixedPrice(
        slots,
        (s) => s.batteryCharge - chargeFromGrid(s, o),
        o.exportPriceEurKwh,
        o.timezone,
      )
    : { cents: 0, byMonth: {}, kwh: 0 };
  return {
    totalCents: discharge.cents - gridCharge.cents - lost.cents,
    parts: {
      avoided: discharge.cents,
      export: 0,
      gridCharge: -gridCharge.cents || 0,
      lostExport: -lost.cents || 0,
    },
    kwh: { avoided: discharge.kwh, exported: 0, gridCharge: gridCharge.kwh },
    byMonth: combine([
      { sign: 1, byMonth: discharge.byMonth },
      { sign: -1, byMonth: gridCharge.byMonth },
      { sign: -1, byMonth: lost.byMonth },
    ]),
  };
}
