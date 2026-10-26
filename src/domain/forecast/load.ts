import { localParts } from "@/lib/time";

// Consommation prévue du foyer (T69, SPEC §7.14) : médiane, heure par heure, des derniers
// jours du même type (semaine, samedi, dimanche) ; pour un chauffage électrique, l'écart de
// degrés-jours prévu × la pente apprise (kWh par degré-jour). Pur.

/** Jours de référence du même type. */
const REFERENCE_DAYS = 4;
/** Heures reçues pour qu'un jour serve de référence. */
const MIN_HOURS = 20;
/** Jours nécessaires pour apprendre la pente de chauffage. */
const MIN_SLOPE_DAYS = 10;
/** La correction de chauffage ne fait jamais descendre la journée sous ce facteur. */
const MIN_SCALE = 0.3;

type DayType = "weekday" | "saturday" | "sunday";
const dayType = (weekday: number): DayType =>
  weekday === 6 ? "saturday" : weekday === 7 ? "sunday" : "weekday";
const weekdayOf = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Pente kWh par degré-jour (moindres carrés), jamais négative ; 0 faute de jours. */
export function heatingSlope(days: readonly { load: number; hdd: number }[]): number {
  if (days.length < MIN_SLOPE_DAYS) return 0;
  const mx = days.reduce((a, d) => a + d.hdd, 0) / days.length;
  const my = days.reduce((a, d) => a + d.load, 0) / days.length;
  const sxx = days.reduce((a, d) => a + (d.hdd - mx) ** 2, 0);
  if (sxx === 0) return 0;
  const sxy = days.reduce((a, d) => a + (d.hdd - mx) * (d.load - my), 0);
  return Math.max(0, sxy / sxx);
}

/**
 * Consommation prévue des 24 heures locales du jour `date` (kWh) ; null sans aucun jour de
 * référence. Moins de 2 jours du même type : les 4 derniers jours complets, tous types.
 */
export function forecastDayLoad(input: {
  /** Consommation horaire mesurée du foyer, avant `date`. */
  history: readonly { start: Date; kwh: number }[];
  date: string;
  timezone: string;
  heating: { slope: number; hddByDate: ReadonlyMap<string, number>; targetHdd: number } | null;
}): number[] | null {
  const days = new Map<string, Map<number, number>>();
  for (const x of input.history) {
    const p = localParts(x.start, input.timezone);
    if (p.date >= input.date) continue;
    const hours = days.get(p.date) ?? new Map<number, number>();
    hours.set(p.hour, (hours.get(p.hour) ?? 0) + x.kwh);
    days.set(p.date, hours);
  }
  const complete = [...days.entries()]
    .filter(([, hours]) => hours.size >= MIN_HOURS)
    .sort(([a], [b]) => b.localeCompare(a));
  const type = dayType(weekdayOf(input.date));
  const same = complete.filter(([d]) => dayType(weekdayOf(d)) === type);
  const reference = (same.length >= 2 ? same : complete).slice(0, REFERENCE_DAYS);
  if (reference.length === 0) return null;

  const profile = Array.from({ length: 24 }, (_, h) => {
    const values = reference.flatMap(([, hours]) => (hours.has(h) ? [hours.get(h) as number] : []));
    return values.length > 0 ? median(values) : 0;
  });
  const h = input.heating;
  const total = profile.reduce((a, b) => a + b, 0);
  if (!h || h.slope === 0 || total === 0) return profile;
  const refHdd = reference
    .map(([d]) => h.hddByDate.get(d))
    .filter((v): v is number => v !== undefined);
  if (refHdd.length === 0) return profile;
  const delta = h.slope * (h.targetHdd - refHdd.reduce((a, b) => a + b, 0) / refHdd.length);
  const scale = Math.max(MIN_SCALE, (total + delta) / total);
  return profile.map((v) => v * scale);
}
