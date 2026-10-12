import { and, eq, gte, lt, lte } from "drizzle-orm";
import { db } from "@/db";
import { contract, sobrietyDay, sobrietyOverride, spotPrice } from "@/db/schema";
import type { PricingContext, TempoColor } from "@/domain/tariff/types";
import { addDays, zonedInstant } from "@/lib/time";
import { tempoColorsFor } from "./tempo/sync";

// Données qui modulent les prix (SPEC §7.8, §7.12) : couleurs Tempo, jours de sobriété EDF
// Zen Flex (T57) et prix spot EPEX France (T58). Les calendriers globaux peuvent être corrigés
// par le foyer ; tous les calculs de coût passent par ici pour en tenir compte de la même
// façon.

/** Jours de sobriété de [from, to] : calendrier importé, puis corrections du foyer. */
export async function sobrietyDaysFor(
  householdId: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const [global, overrides] = await Promise.all([
    db
      .select({ date: sobrietyDay.date })
      .from(sobrietyDay)
      .where(and(gte(sobrietyDay.date, from), lte(sobrietyDay.date, to))),
    sobrietyOverrides(householdId, from, to),
  ]);
  const days = new Set(global.map((r) => r.date));
  for (const o of overrides) {
    if (o.sobriety) days.add(o.date);
    else days.delete(o.date);
  }
  return days;
}

function sobrietyOverrides(householdId: string, from: string, to: string) {
  return db
    .select({ date: sobrietyOverride.date, sobriety: sobrietyOverride.sobriety })
    .from(sobrietyOverride)
    .where(
      and(
        eq(sobrietyOverride.householdId, householdId),
        gte(sobrietyOverride.date, from),
        lte(sobrietyOverride.date, to),
      ),
    );
}

export interface PricingDays {
  colors: Map<string, TempoColor>;
  sobriety: Set<string>;
  /** Prix spot chargés (heures de la période) ; vide si le foyer n'en a pas besoin. */
  spotHours: number;
  /** À fusionner dans un contexte de calcul (`PricingContext`). */
  calendars: Pick<PricingContext, "tempoColor" | "sobrietyDay" | "spotPrice" | "spotFallback">;
}

/** Prix spot des jours locaux [from, to] (€/MWh par heure UTC, clé : instant en ms). */
async function spotPricesFor(from: string, to: string, timezone: string) {
  const rows = await db
    .select({ start: spotPrice.start, eurMwh: spotPrice.eurMwh })
    .from(spotPrice)
    .where(
      and(
        gte(spotPrice.start, zonedInstant(from, 0, timezone)),
        lt(spotPrice.start, zonedInstant(addDays(to, 1), 0, timezone)),
      ),
    );
  return new Map(rows.map((r) => [r.start.getTime(), r.eurMwh]));
}

const hasSpotContract = async (householdId: string) =>
  (await db.$count(
    contract,
    and(eq(contract.householdId, householdId), eq(contract.kind, "spot")),
  )) > 0;

/**
 * Couleurs Tempo, jours de sobriété et prix spot du foyer sur [from, to], prêts pour le
 * moteur. Les prix spot ne sont lus que si le foyer a un contrat spot, ou si `spot` est
 * demandé (comparaison avec les offres du marché).
 */
export async function pricingDays(
  householdId: string,
  from: string,
  to: string,
  options: { spot?: boolean; timezone?: string } = {},
): Promise<PricingDays> {
  const timezone = options.timezone ?? "Europe/Paris";
  const [colors, sobriety, spot] = await Promise.all([
    tempoColorsFor(householdId, from, to),
    sobrietyDaysFor(householdId, from, to),
    (options.spot ?? (await hasSpotContract(householdId)))
      ? spotPricesFor(from, to, timezone)
      : new Map<number, number>(),
  ]);
  const values = [...spot.values()];
  return {
    colors,
    sobriety,
    spotHours: spot.size,
    calendars: {
      tempoColor: (d) => colors.get(d),
      sobrietyDay: (d) => sobriety.has(d),
      spotPrice: (start) => spot.get(start.getTime()),
      spotFallback:
        values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : undefined,
    },
  };
}

/** Jours [from, to] du calendrier Zen Flex avec leur provenance, pour l'écran Contrats. */
export async function sobrietyCalendarView(householdId: string, from: string, to: string) {
  const [global, overrides] = await Promise.all([
    db
      .select({ date: sobrietyDay.date })
      .from(sobrietyDay)
      .where(and(gte(sobrietyDay.date, from), lte(sobrietyDay.date, to))),
    sobrietyOverrides(householdId, from, to),
  ]);
  const days = new Map<string, { sobriety: boolean; source: "manual" | "calendar" }>();
  for (const r of global) days.set(r.date, { sobriety: true, source: "calendar" });
  for (const o of overrides) days.set(o.date, { sobriety: o.sobriety, source: "manual" });
  return days;
}

/** Correction manuelle d'un jour (null : retire la correction, le calendrier reprend la main). */
export async function setManualSobriety(
  householdId: string,
  date: string,
  sobriety: boolean | null,
) {
  if (sobriety === null) {
    await db
      .delete(sobrietyOverride)
      .where(and(eq(sobrietyOverride.householdId, householdId), eq(sobrietyOverride.date, date)));
    return;
  }
  await db
    .insert(sobrietyOverride)
    .values({ householdId, date, sobriety })
    .onConflictDoUpdate({
      target: [sobrietyOverride.householdId, sobrietyOverride.date],
      set: { sobriety },
    });
}
