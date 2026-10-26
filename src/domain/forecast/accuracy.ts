import { localParts } from "@/lib/time";

// Prévu contre réel (T73, SPEC §7.14) : la prévision figée la veille au soir face aux
// mesures, jour par jour, et l'écart moyen (somme des écarts ÷ somme du réel), sur les jours
// terminés dont la consommation est complète. Pur.

/** Heures mesurées pour qu'un jour compte. */
const MIN_HOURS = 20;

interface Pair {
  forecast: number;
  actual: number;
}

export interface AccuracyDay {
  date: string;
  /** null : pas de production mesurée ce jour-là (foyer sans solaire). */
  solar: Pair | null;
  load: Pair;
}

const byDate = <T extends { start: Date }>(
  rows: readonly T[],
  tz: string,
  pick: (r: T) => number,
) => {
  const out = new Map<string, { sum: number; hours: number }>();
  for (const r of rows) {
    const d = localParts(r.start, tz).date;
    const acc = out.get(d) ?? { sum: 0, hours: 0 };
    acc.sum += pick(r);
    acc.hours += 1;
    out.set(d, acc);
  }
  return out;
};

const error = (pairs: (Pair | null)[]) => {
  const known = pairs.filter((p): p is Pair => p !== null);
  const actual = known.reduce((a, p) => a + p.actual, 0);
  return known.length > 0 && actual > 0
    ? known.reduce((a, p) => a + Math.abs(p.forecast - p.actual), 0) / actual
    : null;
};

export function compareForecast(input: {
  forecast: readonly { start: Date; solarKwh: number; loadKwh: number }[];
  solar: readonly { start: Date; kwh: number }[];
  load: readonly { start: Date; kwh: number }[];
  timezone: string;
  /** Jour local en cours (exclu). */
  today: string;
}): { days: AccuracyDay[]; solarError: number | null; loadError: number | null } {
  const tz = input.timezone;
  const fSolar = byDate(input.forecast, tz, (r) => r.solarKwh);
  const fLoad = byDate(input.forecast, tz, (r) => r.loadKwh);
  const aSolar = byDate(input.solar, tz, (r) => r.kwh);
  const aLoad = byDate(input.load, tz, (r) => r.kwh);
  const days = [...fLoad.keys()]
    .filter((d) => d < input.today && (aLoad.get(d)?.hours ?? 0) >= MIN_HOURS)
    .sort((a, b) => b.localeCompare(a))
    .map((date) => ({
      date,
      solar: aSolar.has(date)
        ? { forecast: fSolar.get(date)?.sum ?? 0, actual: aSolar.get(date)?.sum ?? 0 }
        : null,
      load: { forecast: fLoad.get(date)?.sum ?? 0, actual: aLoad.get(date)?.sum ?? 0 },
    }));
  return {
    days,
    solarError: error(days.map((d) => d.solar)),
    loadError: error(days.map((d) => d.load)),
  };
}
