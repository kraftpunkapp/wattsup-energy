// Projection de fin d'année (SPEC §9, Vue d'ensemble) : « à ce rythme, X € sur l'année ».
// Les mois restants reprennent le même mois de l'année précédente, corrigé de la tendance
// des mois terminés (dépense de cette année ÷ même mois N-1) : un hiver plus froid, un
// nouvel appareil ou une hausse de prix s'y retrouvent. Le mois en cours compte le réel
// déjà dépensé plus l'estimation des jours restants. Montants en centimes. Pur.

export interface ProjectionMonth {
  /** « AAAA-MM », les 12 mois de l'année. */
  key: string;
  /** Dépense réelle (abonnement compris) ; null pour un mois à venir. */
  actualCents: number | null;
  /** Même mois de l'année précédente (mois entier), null sans donnée. */
  previousCents: number | null;
}

export interface Projection {
  totalCents: number;
  /** Fourchette (±15 % de la part estimée) quand moins de 3 mois sont comparables. */
  lowCents: number | null;
  highCents: number | null;
  /** Total de l'année précédente, si ses 12 mois sont connus. */
  previousTotalCents: number | null;
  /** Dépense des mois terminés ÷ mêmes mois N-1 (1 sans comparaison). */
  trend: number;
  /** Estimation de chaque mois entier à venir (après le mois en cours), pour le graphique. */
  futureMonths: { key: string; cents: number }[];
}

const MIN_COMPARABLE = 3;
const SPREAD = 0.15;

export function projectYear(
  months: readonly ProjectionMonth[],
  current: { key: string; elapsedDays: number; daysInMonth: number },
): Projection | null {
  const done = months.filter((m) => m.key < current.key && m.actualCents !== null);
  const comparable = done.filter((m) => m.previousCents !== null && m.previousCents > 0);
  const sumActual = comparable.reduce((a, m) => a + (m.actualCents ?? 0), 0);
  const sumPrevious = comparable.reduce((a, m) => a + (m.previousCents ?? 0), 0);
  const trend = sumPrevious > 0 ? sumActual / sumPrevious : 1;
  const average =
    done.length > 0 ? done.reduce((a, m) => a + (m.actualCents ?? 0), 0) / done.length : null;

  /** Estimation d'un mois entier encore à venir. */
  const estimate = (m: ProjectionMonth): number | null =>
    m.previousCents !== null ? m.previousCents * trend : average;

  let known = 0;
  let estimated = 0;
  const futureMonths: Projection["futureMonths"] = [];
  for (const m of months) {
    if (m.key < current.key) {
      known += m.actualCents ?? 0;
      continue;
    }
    const full = estimate(m);
    if (m.key === current.key) {
      known += m.actualCents ?? 0;
      if (full === null) return null;
      estimated += full * (1 - current.elapsedDays / current.daysInMonth);
    } else {
      if (full === null) return null;
      estimated += full;
      futureMonths.push({ key: m.key, cents: Math.round(full) });
    }
  }

  const total = Math.round(known + estimated);
  const uncertain = comparable.length < MIN_COMPARABLE;
  const previous = months.every((m) => m.previousCents !== null)
    ? months.reduce((a, m) => a + (m.previousCents ?? 0), 0)
    : null;
  return {
    totalCents: total,
    lowCents: uncertain ? Math.round(total - SPREAD * estimated) : null,
    highCents: uncertain ? Math.round(total + SPREAD * estimated) : null,
    previousTotalCents: previous,
    trend: Math.round(trend * 1000) / 1000,
    futureMonths,
  };
}
