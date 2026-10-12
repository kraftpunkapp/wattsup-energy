import { formatDay } from "@/lib/format";
import { addDays, eachDay, localParts } from "@/lib/time";
import { priceIntervals } from "./engine";
import type {
  Contract,
  MonthBreakdown,
  PriceableInterval,
  PricingContext,
  PricedResult,
} from "./types";

// Contrats datés et historique de prix (SPEC §7.1, T18b). Un contrat souscrit couvre
// [startDate, endDate] (fin incluse, vide = en cours) ; ses grilles datées s'appliquent
// chacune de validFrom jusqu'à la suivante. Fonctions pures.

export interface PricePeriod {
  /** Date d'effet AAAA-MM-JJ. */
  validFrom: string;
  contract: Contract;
}

export interface DatedContract {
  id: string;
  name: string;
  status: "subscribed" | "simulated";
  startDate: string | null;
  endDate: string | null;
  /** Au moins une grille. */
  periods: PricePeriod[];
}

const byDate = (a: PricePeriod, b: PricePeriod) => a.validFrom.localeCompare(b.validFrom);

/** Période de prix en vigueur à une date : la plus récente déjà effective, sinon la première. */
export function periodAt<P extends PricePeriod>(
  c: { name: string; periods: P[] },
  date: string,
): P {
  const sorted = [...c.periods].sort(byDate);
  const effective = sorted.filter((p) => p.validFrom <= date).at(-1) ?? sorted[0];
  if (!effective) throw new Error(`contrat sans grille : ${c.name}`);
  return effective;
}

/** Grille en vigueur à une date. */
export const gridAt = (c: DatedContract, date: string): Contract => periodAt(c, date).contract;

/** Grille la plus récente (celle qu'on simule pour comparer les offres aujourd'hui). */
export const latestGrid = (c: DatedContract): Contract => gridAt(c, "9999-12-31");

const activeOn = (c: DatedContract, date: string) =>
  c.status === "subscribed" &&
  c.startDate !== null &&
  c.startDate <= date &&
  (c.endDate === null || date <= c.endDate);

/** Contrat souscrit en vigueur à une date (au plus un, les périodes ne se chevauchant pas). */
export function currentContract(contracts: readonly DatedContract[], date: string) {
  return contracts.find((c) => activeOn(c, date)) ?? null;
}

/**
 * Aucun contrat en cours alors que le dernier contrat souscrit s'est terminé : souvent une
 * date de fin saisie par erreur (échéance d'engagement, fin d'une grille de prix…).
 */
export function lapsedContract<C extends DatedContract>(contracts: readonly C[], date: string) {
  if (currentContract(contracts, date)) return null;
  const last = contracts
    .filter((c) => c.status === "subscribed" && c.startDate !== null)
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))
    .at(-1);
  return last?.endDate && last.endDate < date ? last : null;
}

const period = (c: DatedContract) =>
  c.endDate === null
    ? `depuis le ${formatDay(c.startDate ?? "")}`
    : `du ${formatDay(c.startDate ?? "")} au ${formatDay(c.endDate)}`;

const overlap = (a: DatedContract, b: DatedContract) =>
  (a.startDate ?? "") <= (b.endDate ?? "9999-12-31") &&
  (b.startDate ?? "") <= (a.endDate ?? "9999-12-31");

/**
 * Incohérences après l'enregistrement du contrat `focusId` : une fin avant le début, ou une
 * période qui en recouvre une autre. Seuls les chevauchements de ce contrat sont signalés :
 * une incohérence ancienne ne bloque pas une saisie sans rapport.
 */
export function findOverlaps(contracts: readonly DatedContract[], focusId: string): string[] {
  const subscribed = contracts
    .filter((c) => c.status === "subscribed" && c.startDate !== null)
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
  const reversed = subscribed
    .filter((c) => c.endDate !== null && c.endDate < (c.startDate ?? ""))
    .map(
      (c) =>
        `« ${c.name} » : la fin (${formatDay(c.endDate ?? "")}) précède le début (${formatDay(c.startDate ?? "")})`,
    );
  if (reversed.length > 0) return reversed;
  const focus = subscribed.find((c) => c.id === focusId);
  if (!focus) return [];
  return subscribed
    .filter((c) => c.id !== focusId && overlap(focus, c))
    .map((c) => `Ce contrat (${period(focus)}) recouvre « ${c.name} » (${period(c)})`);
}

export interface Segment {
  /** Jours locaux [from, to). */
  from: string;
  to: string;
  /** Contrat souscrit en vigueur ; null si aucun (jour estimé ou non valorisable). */
  contractId: string | null;
  contract: Contract | null;
}

/**
 * Frise de [from, to) : un segment par combinaison (contrat, grille). Les jours sans
 * contrat souscrit reçoivent la grille actuelle du contrat en vigueur le jour `today`
 * (par défaut la veille de `to`), ou aucune s'il n'y en a pas.
 */
export function buildTimeline(
  contracts: readonly DatedContract[],
  from: string,
  to: string,
  today = addDays(to, -1),
): Segment[] {
  const current = currentContract(contracts, today);
  const fallback = current ? latestGrid(current) : null;

  const cuts = new Set([from, to]);
  for (const c of contracts) {
    if (c.status !== "subscribed" || c.startDate === null) continue;
    cuts.add(c.startDate);
    if (c.endDate !== null) cuts.add(addDays(c.endDate, 1));
    for (const p of c.periods) cuts.add(p.validFrom);
  }
  const bounds = [...cuts].filter((d) => d >= from && d <= to).sort();

  const segments: Segment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i] as string;
    const b = bounds[i + 1] as string;
    const c = currentContract(contracts, a);
    const contract = c ? gridAt(c, a) : fallback;
    const last = segments.at(-1);
    if (last && last.contractId === (c?.id ?? null) && last.contract === contract) {
      last.to = b; // même contrat et même grille : on prolonge
    } else {
      segments.push({ from: a, to: b, contractId: c?.id ?? null, contract });
    }
  }
  return segments;
}

export interface TimelineResult extends PricedResult {
  /** Jours valorisés sans contrat souscrit (grille du contrat actuel). */
  unknownContractDays: number;
  /** kWh non valorisés faute de toute grille. */
  unpricedKwh: number;
}

/**
 * Coût réel d'intervalles selon une frise : chaque intervalle est rattaché au segment
 * de son jour local, chaque segment est valorisé par le moteur (abonnement compris).
 * Les centimes sont arrondis par segment.
 */
export function priceTimeline(
  intervals: readonly PriceableInterval[],
  segments: readonly Segment[],
  ctx: Pick<
    PricingContext,
    "timezone" | "tempoColor" | "sobrietyDay" | "spotPrice" | "spotFallback"
  >,
): TimelineResult {
  const dayOf = (i: PriceableInterval) =>
    i.granularity === "hour" ? localParts(i.start, ctx.timezone).date : i.date;
  const buckets = segments.map(() => [] as PriceableInterval[]);
  for (const interval of intervals) {
    const day = dayOf(interval);
    const index = segments.findIndex((s) => s.from <= day && day < s.to);
    if (index !== -1) buckets[index]?.push(interval);
  }

  const result: TimelineResult = {
    totalCents: 0,
    energyCents: 0,
    subscriptionCents: 0,
    kwh: 0,
    byMonth: {},
    bySlot: {},
    approximatedKwh: 0,
    assumedTempoDays: 0,
    assumedSpotHours: 0,
    unknownContractDays: 0,
    unpricedKwh: 0,
  };

  segments.forEach((segment, i) => {
    const list = buckets[i] ?? [];
    if (segment.contractId === null)
      result.unknownContractDays += eachDay(segment.from, segment.to).length;
    if (!segment.contract) {
      result.unpricedKwh += list.reduce((a, x) => a + x.kwh, 0);
      return;
    }
    const r = priceIntervals(list, segment.contract, {
      timezone: ctx.timezone,
      period: { from: segment.from, to: segment.to },
      tempoColor: ctx.tempoColor,
      sobrietyDay: ctx.sobrietyDay,
      spotPrice: ctx.spotPrice,
      spotFallback: ctx.spotFallback,
    });
    result.totalCents += r.totalCents;
    result.energyCents += r.energyCents;
    result.subscriptionCents += r.subscriptionCents;
    result.kwh += r.kwh;
    result.approximatedKwh += r.approximatedKwh;
    result.assumedTempoDays += r.assumedTempoDays;
    result.assumedSpotHours += r.assumedSpotHours;
    for (const [month, m] of Object.entries(r.byMonth)) {
      const acc: MonthBreakdown = result.byMonth[month] ?? {
        energyCents: 0,
        subscriptionCents: 0,
        kwh: 0,
        slotKwh: {},
      };
      acc.energyCents += m.energyCents;
      acc.subscriptionCents += m.subscriptionCents;
      acc.kwh += m.kwh;
      for (const [slot, k] of Object.entries(m.slotKwh)) {
        acc.slotKwh[slot] = (acc.slotKwh[slot] ?? 0) + k;
      }
      result.byMonth[month] = acc;
    }
    for (const [slot, s] of Object.entries(r.bySlot)) {
      const acc = result.bySlot[slot] ?? { kwh: 0, energyCents: 0 };
      acc.kwh += s.kwh;
      acc.energyCents += s.energyCents;
      result.bySlot[slot] = acc;
    }
  });
  return result;
}
