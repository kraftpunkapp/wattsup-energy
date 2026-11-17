// Combustibles : granulés et bois (SPEC §7.4, T23). Fonctions pures. Les quantités sont
// ramenées à une unité de base : le kg pour les granulés, le stère pour le bois.

export type Fuel = "pellet" | "wood";
export type FuelUnit = "bag" | "pallet" | "kg" | "stere";
export type FuelEventType = "purchase" | "stock_snapshot" | "consumption";

export interface FuelEvent {
  fuel: Fuel;
  type: FuelEventType;
  /** Instant de l'événement (ordre des relevés, achats et consommations). */
  at: Date;
  qty: number;
  unit: FuelUnit;
  /** Prix total TTC d'un achat ; null si inconnu ou pour les autres types. */
  priceEur: number | null;
}

export interface FuelSettings {
  pelletBagKg: number;
  pelletBagsPerPallet: number;
}

/** Unité de base d'un combustible : kg pour les granulés, stère pour le bois. */
export const BASE_UNIT: Record<Fuel, "kg" | "stere"> = { pellet: "kg", wood: "stere" };

/** Unités saisissables pour un combustible. */
export const UNITS_FOR: Record<Fuel, readonly FuelUnit[]> = {
  pellet: ["bag", "pallet", "kg"],
  wood: ["stere"],
};

export const isUnitFor = (fuel: Fuel, unit: FuelUnit) => UNITS_FOR[fuel].includes(unit);

/** Quantité en unité de base (kg ou stère) ; une unité incohérente est une erreur. */
export function toBaseQty(e: Pick<FuelEvent, "fuel" | "qty" | "unit">, s: FuelSettings): number {
  if (e.fuel === "wood") {
    if (e.unit !== "stere") throw new Error(`unité « ${e.unit} » impossible pour le bois`);
    return e.qty;
  }
  switch (e.unit) {
    case "kg":
      return e.qty;
    case "bag":
      return e.qty * s.pelletBagKg;
    case "pallet":
      return e.qty * s.pelletBagsPerPallet * s.pelletBagKg;
    default:
      throw new Error(`unité « ${e.unit} » impossible pour les granulés`);
  }
}

const ofFuel = (events: readonly FuelEvent[], fuel: Fuel) =>
  events.filter((e) => e.fuel === fuel).sort((a, b) => a.at.getTime() - b.at.getTime());

/**
 * Stock à un instant = dernier relevé (« Corriger le stock ») + achats − consommations
 * depuis ; sans relevé, depuis zéro. Peut être négatif (relevé à refaire).
 */
export function currentStock(
  events: readonly FuelEvent[],
  fuel: Fuel,
  at: Date,
  s: FuelSettings,
): number {
  let stock = 0;
  for (const e of ofFuel(events, fuel)) {
    if (e.at > at) break;
    const qty = toBaseQty(e, s);
    if (e.type === "stock_snapshot") stock = qty;
    else if (e.type === "purchase") stock += qty;
    else stock -= qty;
  }
  return stock;
}

export interface Season {
  from: Date;
  /** Exclu. */
  to: Date;
}

/**
 * Consommation d'une saison, par ordre de priorité : (1) consommations saisies, (2) écarts
 * entre relevés de la saison corrigés des achats. Le compteur poussé par HA viendra plus
 * tard (bloc `fuel` du payload, encore ignoré).
 */
export function seasonConsumption(
  events: readonly FuelEvent[],
  fuel: Fuel,
  season: Season,
  s: FuelSettings,
): { qty: number; method: "events" | "snapshots" | "none" } {
  const inSeason = ofFuel(events, fuel).filter((e) => e.at >= season.from && e.at < season.to);
  const consumptions = inSeason.filter((e) => e.type === "consumption");
  if (consumptions.length > 0) {
    return { qty: consumptions.reduce((a, e) => a + toBaseQty(e, s), 0), method: "events" };
  }
  let qty = 0;
  let previous: number | null = null;
  let purchased = 0;
  let pairs = 0;
  for (const e of inSeason) {
    if (e.type === "purchase") purchased += toBaseQty(e, s);
    if (e.type !== "stock_snapshot") continue;
    const level = toBaseQty(e, s);
    if (previous !== null) {
      qty += previous + purchased - level;
      pairs += 1;
    }
    previous = level;
    purchased = 0;
  }
  return pairs > 0 ? { qty, method: "snapshots" } : { qty: 0, method: "none" };
}

const pricedPurchases = (events: readonly FuelEvent[], fuel: Fuel) =>
  ofFuel(events, fuel).filter((e) => e.type === "purchase" && e.priceEur !== null);

/** Fenêtre du prix de référence : les achats des 12 mois précédents. */
const PRICE_WINDOW_MS = 365 * 86_400_000;

export type ReferencePrice =
  | { perUnit: number; basis: "recent" }
  /** Aucun achat chiffré dans les 12 mois : le dernier avant, sinon le premier après. */
  | { perUnit: number; basis: "last" | "next"; purchasedAt: Date };

const unitPrice = (e: FuelEvent, s: FuelSettings) => {
  const qty = toBaseQty(e, s);
  return qty > 0 ? (e.priceEur ?? 0) / qty : null;
};

/**
 * Prix de référence à une date, en € par kg (granulés) ou par stère (bois) : moyenne des
 * achats chiffrés des 12 mois précédents, pondérée par la quantité. Un prix ancien ne
 * pèse donc plus sur le coût d'aujourd'hui.
 */
export function referencePrice(
  events: readonly FuelEvent[],
  fuel: Fuel,
  s: FuelSettings,
  at: Date,
): ReferencePrice | null {
  const purchases = pricedPurchases(events, fuel);
  const recent = purchases.filter(
    (e) => e.at <= at && e.at.getTime() > at.getTime() - PRICE_WINDOW_MS,
  );
  const qty = recent.reduce((a, e) => a + toBaseQty(e, s), 0);
  if (qty > 0) {
    return { perUnit: recent.reduce((a, e) => a + (e.priceEur ?? 0), 0) / qty, basis: "recent" };
  }
  const last = purchases.filter((e) => e.at <= at).at(-1);
  const next = purchases.find((e) => e.at > at);
  const fallback = last ?? next;
  const perUnit = fallback ? unitPrice(fallback, s) : null;
  return fallback && perUnit !== null
    ? { perUnit, basis: last ? "last" : "next", purchasedAt: fallback.at }
    : null;
}

/**
 * Prix unitaire du dernier achat payant (base de la prévision, SPEC §7.5). Un lot gratuit
 * (bois coupé sur place, don) compte dans le coût réel de la saison mais ne dit rien du
 * prix de la prochaine commande : il est ignoré ici.
 */
export function lastPurchasePrice(
  events: readonly FuelEvent[],
  fuel: Fuel,
  s: FuelSettings,
): number | null {
  const last = pricedPurchases(events, fuel)
    .filter((e) => (e.priceEur ?? 0) > 0)
    .at(-1);
  return last ? unitPrice(last, s) : null;
}
