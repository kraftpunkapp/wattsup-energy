// Heures creuses d'un contrat (T80, T81) : réforme de 2025-2027, horaires propres à chaque
// foyer, différents l'été.

import { SUMMER_MONTHS } from "./seasons";
import type { Contract, OffPeakHours, TimeRange } from "./types";

/** Plages creuses en vigueur un jour local (AAAA-MM-JJ). */
export function offPeakRangesAt(hours: OffPeakHours, date: string): TimeRange[] {
  const summer = SUMMER_MONTHS.includes(Number(date.slice(5, 7)));
  return (summer && hours.summerHcRanges) || hours.hcRanges;
}

/** Vrai si le foyer doit vérifier ses horaires : grille HP/HC encore sans plages d'été. */
export const needsOffPeakCheck = (current: Contract | null): boolean =>
  current?.kind === "hphc" && !current.summerHcRanges;
