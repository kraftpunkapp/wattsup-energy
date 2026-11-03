import { addDays } from "@/lib/time";

// Amortissement (SPEC §7.2) : économie mensuelle moyenne sur les 12 derniers mois,
// date d'amortissement = aujourd'hui + (coût − économies cumulées) / économie mensuelle.

export interface Payback {
  /** Part du coût déjà remboursée, 0–1 (plafonnée à 1). */
  ratio: number;
  cumulativeCents: number;
  /** Moyenne des 12 derniers mois (ou des mois disponibles). */
  monthlyCents: number;
  /** Nombre de mois complets dans cette moyenne (au plus 12). */
  averagedMonths: number;
  /** null : déjà amorti, ou aucune économie mensuelle positive. */
  paybackDate: string | null;
  status: "amortized" | "in-progress" | "no-savings";
}

const DAYS_PER_MONTH = 365.25 / 12;

/**
 * @param byMonth économies par mois « AAAA-MM », depuis l'installation.
 * @param currentMonth mois en cours (exclu de la moyenne : il est incomplet).
 */
export function payback(input: {
  costEur: number;
  byMonth: Record<string, number>;
  currentMonth: string;
  today: string;
}): Payback {
  const months = Object.keys(input.byMonth).sort();
  const cumulativeCents = months.reduce((a, m) => a + (input.byMonth[m] ?? 0), 0);
  const complete = months.filter((m) => m < input.currentMonth).slice(-12);
  const monthlyCents =
    complete.length > 0
      ? complete.reduce((a, m) => a + (input.byMonth[m] ?? 0), 0) / complete.length
      : 0;
  const costCents = input.costEur * 100;
  const ratio = costCents > 0 ? Math.min(1, Math.max(0, cumulativeCents / costCents)) : 1;
  const base = { ratio, cumulativeCents, monthlyCents, averagedMonths: complete.length };
  if (cumulativeCents >= costCents) {
    return { ...base, paybackDate: null, status: "amortized" };
  }
  if (monthlyCents <= 0) {
    return { ...base, paybackDate: null, status: "no-savings" };
  }
  const monthsLeft = (costCents - cumulativeCents) / monthlyCents;
  return {
    ...base,
    paybackDate: addDays(input.today, Math.ceil(monthsLeft * DAYS_PER_MONTH)),
    status: "in-progress",
  };
}

const MILESTONES = [0.25, 0.5, 0.75, 1] as const;

/** Prochain palier de remboursement (le quart, la moitié…) et sa date, null une fois amorti. */
export function nextMilestone(input: {
  costEur: number;
  cumulativeCents: number;
  monthlyCents: number;
  today: string;
}): { ratio: (typeof MILESTONES)[number]; date: string | null } | null {
  const costCents = input.costEur * 100;
  if (costCents <= 0) return null;
  const ratio = MILESTONES.find((m) => input.cumulativeCents < m * costCents - 1e-9);
  if (ratio === undefined) return null;
  if (input.monthlyCents <= 0) return { ratio, date: null };
  const monthsLeft = (ratio * costCents - input.cumulativeCents) / input.monthlyCents;
  return { ratio, date: addDays(input.today, Math.ceil(monthsLeft * DAYS_PER_MONTH)) };
}

/** Économies des 12 derniers mois complets (ou de ceux qu'on a), avec leurs bornes « AAAA-MM ». */
export function recentSavings(
  byMonth: Record<string, number>,
  currentMonth: string,
): { cents: number; months: number; from: string; to: string } | null {
  const keys = Object.keys(byMonth)
    .filter((m) => m < currentMonth)
    .sort()
    .slice(-12);
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) return null;
  return {
    cents: keys.reduce((a, m) => a + (byMonth[m] ?? 0), 0),
    months: keys.length,
    from: first,
    to: last,
  };
}

const nextMonthOf = (key: string) => {
  const [y = 0, m = 1] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/**
 * Fourchette d'amortissement quand on mesure depuis moins d'un an. Au plus tôt : les mois
 * mesurés valent tous l'année (l'économie moyenne observée se répète). Au plus tard : elle
 * suit la saison, d'après la production solaire du foyer (`seasonality`, par mois du calendrier).
 * null : un an mesuré (la moyenne suffit), déjà amorti, pas de saisonnalité, ou même date.
 */
export function paybackRange(input: {
  costEur: number;
  cumulativeCents: number;
  byMonth: Record<string, number>;
  seasonality: Record<number, number> | null;
  currentMonth: string;
}): { early: string; late: string } | null {
  const costCents = input.costEur * 100;
  const observed = Object.keys(input.byMonth)
    .filter((m) => m < input.currentMonth)
    .sort();
  if (!input.seasonality || observed.length === 0 || observed.length >= 12) return null;
  if (input.cumulativeCents >= costCents) return null;
  const season = input.seasonality;
  const weight = (m: string) => season[Number(m.slice(5, 7))] ?? 0;
  const flat = observed.reduce((a, m) => a + (input.byMonth[m] ?? 0), 0) / observed.length;
  const observedWeight = observed.reduce((a, m) => a + weight(m), 0) / observed.length;
  if (flat <= 0 || observedWeight <= 0) return null;

  const reach = (rate: (month: string) => number) => {
    let remaining = costCents - input.cumulativeCents;
    let month = input.currentMonth;
    for (let i = 0; i < 600; i++) {
      remaining -= rate(month);
      if (remaining <= 0) return month;
      month = nextMonthOf(month);
    }
    return null;
  };
  const early = reach(() => flat);
  const late = reach((m) => (flat * weight(m)) / observedWeight);
  if (early === null || late === null || early === late) return null;
  return early < late ? { early, late } : { early: late, late: early };
}
