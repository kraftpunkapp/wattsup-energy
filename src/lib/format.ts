// Formatage fr-FR : seul endroit où l'on arrondit pour l'affichage (SPEC §10).
import { addDays, eachDay } from "./time";

// fr-FR utilise des espaces fines insécables (U+202F) comme séparateur de milliers.
function number(value: number, digits: number): string {
  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatNumber(value: number, digits = 0): string {
  return number(value, digits);
}

/** Estimation en euros arrondie à 5 € près (« ≈ 190 € ») : la même partout pour un même chiffre. */
export function formatRoughEur(value: number): string {
  return `${number(Math.round(value / 5) * 5, 0)} €`;
}

export function formatEur(value: number, digits = 0): string {
  return `${number(value, digits)} €`;
}

export function formatEurFromCents(cents: number, digits = 2): string {
  return formatEur(cents / 100, digits);
}

export function formatKwh(value: number, digits = 0): string {
  return `${number(value, digits)} kWh`;
}

export function formatPercent(ratio: number, digits = 0): string {
  return `${number(ratio * 100, digits)} %`;
}

/** Jour AAAA-MM-JJ → JJ/MM/AAAA. */
export function formatDay(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Durée de la période [from, to] (fin incluse) : « 1 an et 3 mois », « 8 mois », « 15 jours ». */
export function formatDuration(from: string, to: string): string {
  const [y1, m1, d1] = from.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = addDays(to, 1).split("-").map(Number) as [number, number, number];
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 1) return plural(eachDay(from, addDays(to, 1)).length, "jour", "jours");
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years > 0 && plural(years, "an", "ans"), rest > 0 && `${rest} mois`]
    .filter(Boolean)
    .join(" et ");
}

/** Durée écoulée, en clair : « à l'instant », « il y a 12 min », « il y a 5 h », « il y a 3 j ». */
export function formatAgo(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}
