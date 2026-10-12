// Saisons des contrats sur mesure (T56) : raccourcis et libellés des mois d'une règle.

export const WINTER_MONTHS = [11, 12, 1, 2, 3];
export const SUMMER_MONTHS = [4, 5, 6, 7, 8, 9, 10];

export const MONTH_SHORT = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length &&
  [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();

export type MonthsPreset = "all" | "winter" | "summer" | "custom";

export function monthsPreset(months: readonly number[] | undefined): MonthsPreset {
  if (months === undefined || months.length === 12) return "all";
  if (same(months, WINTER_MONTHS)) return "winter";
  if (same(months, SUMMER_MONTHS)) return "summer";
  return "custom";
}

/** « hiver (nov. – mars) », « été (avr. – oct.) », « janv., févr. » ; null : toute l'année. */
export function monthsLabel(months: readonly number[] | undefined): string | null {
  switch (monthsPreset(months)) {
    case "all":
      return null;
    case "winter":
      return "hiver (nov. – mars)";
    case "summer":
      return "été (avr. – oct.)";
    case "custom":
      return [...(months ?? [])]
        .sort((a, b) => a - b)
        .map((m) => MONTH_SHORT[m - 1])
        .join(", ");
  }
}
