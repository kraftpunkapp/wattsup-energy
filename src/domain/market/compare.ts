import { compareContracts } from "../tariff/compare";
import type { Contract, PriceableInterval, PricingContext, TimeRange } from "../tariff/types";
import {
  CHOOSABLE_DAYS,
  DEFAULT_OFF_PEAK,
  describeOffer,
  REASON_LABELS,
  toContract,
  type SourceTariff,
} from "./offer";

// Comparaison des offres du marché sur la consommation du foyer (SPEC §7.12) : même moteur,
// même période et même référence (le contrat actuel) que la comparaison des contrats du
// foyer. Pur : le serveur fournit le catalogue, la consommation et les couleurs Tempo.

/** Puissances souscrites proposées (kVA). */
export const METER_POWERS = [3, 6, 9, 12, 15, 18, 24, 30, 36] as const;
export type MeterPower = (typeof METER_POWERS)[number];

export function parseMeterPower(value: unknown): MeterPower | null {
  const n = typeof value === "string" ? Number(value) : value;
  return METER_POWERS.find((p) => p === n) ?? null;
}

/**
 * Plages creuses du compteur, déduites du contrat actuel : celles d'un contrat HP/HC, celles
 * de Tempo (22 h – 6 h) ; null sinon (une offre à plages libres les suppose alors).
 */
export function householdOffPeak(current: Contract | null): TimeRange[] | null {
  if (current?.kind === "hphc") return current.hcRanges;
  if (current?.kind === "tempo") return DEFAULT_OFF_PEAK;
  return null;
}

export interface MarketRow {
  name: string;
  provider: string;
  offer: string;
  regulated: boolean;
  gridDate: string;
  kind: Contract["kind"];
  contract: Contract;
  annualCents: number;
  /** Écart annuel avec le contrat actuel (négatif = économie) ; null sans contrat actuel. */
  deltaAnnualCents: number | null;
  /** Heures creuses libres sans plages connues du foyer : 22 h – 6 h supposées. */
  assumedOffPeak: boolean;
  approximate: boolean;
  assumedTempoDays: number;
  assumedSpotHours: number;
  priceUrl: string | null;
  subscriptionUrl: string | null;
  /** Offre à jour choisi : le jour (ISO) le moins cher pour ce foyer ; null sinon. */
  chosenDay: number | null;
}

export interface MarketComparison {
  rows: MarketRow[];
  currentAnnualCents: number | null;
  /** Offres pas encore comparables, avec leur raison (les offres fermées n'y figurent pas). */
  pending: { name: string; reason: string }[];
  /** Offres comparables mais non proposées à cette puissance. */
  unavailable: number;
}

const CURRENT = "\u0000contrat-actuel";

export function compareMarket(
  offers: readonly { name: string; definition: SourceTariff }[],
  kva: number,
  current: Contract | null,
  intervals: readonly PriceableInterval[],
  ctx: PricingContext,
  periodDays: number,
): MarketComparison {
  const offPeak = householdOffPeak(current);
  const pending: MarketComparison["pending"] = [];
  let unavailable = 0;
  const candidates: {
    id: string;
    name: string;
    definition: SourceTariff;
    assumedOffPeak: boolean;
    contract: Contract;
    chosenDay: number | null;
  }[] = [];

  // Offres au prix spot : seulement avec des données horaires et des prix spot connus.
  const daily = intervals.some((i) => i.granularity === "day");
  const spotReason = daily
    ? "hourly-data"
    : ctx.spotFallback === undefined
      ? "no-spot-prices"
      : null;

  for (const o of offers) {
    const info = describeOffer(o.definition);
    if (spotReason && info.support.status === "compared" && info.support.kind === "spot") {
      pending.push({ name: o.name, reason: REASON_LABELS[spotReason] });
      continue;
    }
    if (info.support.status === "pending") {
      pending.push({ name: o.name, reason: REASON_LABELS[info.support.reason] });
      continue;
    }
    if (info.support.status === "never") continue;
    // Jour choisi par l'abonné : les cinq jours possibles sont essayés, le moins cher reste.
    const days: (number | null)[] = info.support.chosenDay ? [...CHOOSABLE_DAYS] : [null];
    const built = days.flatMap((day) => {
      const c = toContract(o.definition, kva, offPeak, day ?? undefined);
      return c ? [{ day, c }] : [];
    });
    if (built.length === 0) {
      unavailable += 1;
      continue;
    }
    for (const { day, c } of built) {
      candidates.push({
        ...o,
        id: day === null ? o.name : `${o.name}\u0000${day}`,
        assumedOffPeak: c.assumedOffPeak,
        contract: c.contract,
        chosenDay: day,
      });
    }
  }

  const compared = compareContracts(
    [
      ...(current ? [{ id: CURRENT, name: CURRENT, isCurrent: true, contract: current }] : []),
      ...candidates.map((c) => ({
        id: c.id,
        name: c.name,
        isCurrent: false,
        contract: c.contract,
      })),
    ],
    intervals,
    ctx,
    periodDays,
  );
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const seen = new Set<string>();
  // Classement du moins cher au plus cher : la première variante d'une offre est sa meilleure.
  const rows: MarketRow[] = compared.flatMap((r) => {
    const c = byId.get(r.id);
    if (!c || seen.has(c.name)) return [];
    seen.add(c.name);
    const info = describeOffer(c.definition);
    return [
      {
        name: c.name,
        provider: info.provider,
        offer: info.offer,
        regulated: info.regulated,
        gridDate: info.gridDate,
        kind: c.contract.kind,
        contract: c.contract,
        annualCents: r.annualCents,
        deltaAnnualCents: r.deltaAnnualCents,
        assumedOffPeak: c.assumedOffPeak,
        approximate: r.approximate,
        assumedTempoDays: r.assumedTempoDays,
        assumedSpotHours: r.assumedSpotHours,
        priceUrl: c.definition.price_url || null,
        subscriptionUrl: c.definition.subscription_url || null,
        chosenDay: c.chosenDay,
      },
    ];
  });
  return {
    rows,
    currentAnnualCents: compared.find((r) => r.isCurrent)?.annualCents ?? null,
    pending: pending.sort((a, b) => a.name.localeCompare(b.name, "fr")),
    unavailable,
  };
}
