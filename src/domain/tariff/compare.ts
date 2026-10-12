import { toSegments } from "./base-hphc";
import { priceIntervals } from "./engine";
import type { Contract, PriceableInterval, PricingContext } from "./types";

// Comparaison de contrats sur une même consommation (T18). Fonction pure : la requête
// qui charge les intervalles vit dans src/server/queries/contracts.ts.

export interface ContractToCompare {
  id: string;
  name: string;
  isCurrent: boolean;
  contract: Contract;
}

export interface ComparedContract extends ContractToCompare {
  /** Coût sur la période analysée, en centimes. */
  totalCents: number;
  /** Coût ramené à 365 jours, en centimes. */
  annualCents: number;
  /** Écart annuel avec le contrat actuel (négatif = économie), null sans contrat actuel. */
  deltaAnnualCents: number | null;
  assumedTempoDays: number;
  /** Heures sans prix spot connu, estimées au prix moyen (T58). */
  assumedSpotHours: number;
  /** Ventilation HP/HC supposée (données journalières et heures creuses différentes). */
  approximate: boolean;
}

const TEMPO_HC = [{ from: "22:00", to: "06:00" }];

/** Plages creuses d'un contrat, normalisées (null si le contrat n'a pas de notion HP/HC). */
function offPeakSignature(c: Contract): string | null {
  const ranges = c.kind === "hphc" ? c.hcRanges : c.kind === "tempo" ? TEMPO_HC : null;
  return ranges ? JSON.stringify(toSegments(ranges).sort((a, b) => a[0] - b[0])) : null;
}

/**
 * Coût de chaque contrat, du moins cher au plus cher. `periodDays` sert à annualiser.
 * En données journalières, la ventilation HP/HC reçue est celle du contrat actuel : un
 * contrat HP/HC ou Tempo aux heures creuses différentes est donc approximatif.
 */
export function compareContracts(
  contracts: readonly ContractToCompare[],
  intervals: readonly PriceableInterval[],
  ctx: PricingContext,
  periodDays: number,
): ComparedContract[] {
  const current = contracts.find((c) => c.isCurrent);
  const daily = intervals.some((i) => i.granularity === "day");
  const currentSignature = current ? offPeakSignature(current.contract) : null;

  const priced = contracts.map((c) => {
    const r = priceIntervals(intervals, c.contract, ctx);
    const signature = offPeakSignature(c.contract);
    const differentOffPeak = signature !== null && signature !== currentSignature;
    return {
      ...c,
      totalCents: r.totalCents,
      annualCents: Math.round((r.totalCents * 365) / periodDays),
      assumedTempoDays: r.assumedTempoDays,
      assumedSpotHours: r.assumedSpotHours,
      approximate: r.approximatedKwh > 0 || (daily && differentOffPeak),
    };
  });

  const currentAnnual = priced.find((c) => c.isCurrent)?.annualCents;
  return priced
    .map((c) => ({
      ...c,
      deltaAnnualCents: currentAnnual === undefined ? null : c.annualCents - currentAnnual,
    }))
    .sort((a, b) => a.annualCents - b.annualCents);
}
