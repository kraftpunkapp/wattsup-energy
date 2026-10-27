import { and, asc, desc, eq, gt, gte, lt, or, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { batteryLevel, energyInterval } from "@/db/schema";
import { isSuspect, valueCap } from "@/domain/ingest/metrics";
import { addDays, zonedInstant } from "@/lib/time";
import type { HouseholdContext } from "./context";

// Onglet Données (SPEC §7.11) : contrôler et corriger les valeurs enregistrées. Chaque
// opération filtre par ctx.householdId ; une valeur corrigée passe en source « manuel »
// et n'est plus touchée par les envois de Home Assistant ni par l'import CSV.

/** Refus métier, message en français pour l'interface. */
export class DataError extends Error {}

/** Identifiant d'une valeur (clé de energy_interval, hors foyer). */
export interface ValueKey {
  metric: string;
  start: Date;
  granularity: "hour" | "day";
  tariffSlot: "all" | "hp" | "hc";
}

export interface StoredValue extends ValueKey {
  kwh: number;
  source: "ha" | "csv" | "manual";
}

export interface RangeInput {
  /** null : tous les compteurs. */
  metric: string | null;
  /** Jours locaux inclus « AAAA-MM-JJ ». */
  from: string;
  to: string;
}

const columns = {
  metric: energyInterval.metric,
  start: energyInterval.start,
  granularity: energyInterval.granularity,
  tariffSlot: energyInterval.tariffSlot,
  kwh: energyInterval.kwh,
  source: energyInterval.source,
};

const keyOf = (ctx: HouseholdContext, k: ValueKey) =>
  and(
    eq(energyInterval.householdId, ctx.householdId),
    eq(energyInterval.metric, k.metric),
    eq(energyInterval.start, k.start),
    eq(energyInterval.granularity, k.granularity),
    eq(energyInterval.tariffSlot, k.tariffSlot),
  );

/** Compteurs ayant au moins une valeur enregistrée. */
export async function storedMetrics(ctx: HouseholdContext): Promise<string[]> {
  const rows = await db
    .selectDistinct({ metric: energyInterval.metric })
    .from(energyInterval)
    .where(eq(energyInterval.householdId, ctx.householdId))
    .orderBy(asc(energyInterval.metric));
  return rows.map((r) => r.metric);
}

/** Vrai si Home Assistant a déjà envoyé au moins un niveau de la batterie (T78). */
export async function hasBatteryLevels(ctx: HouseholdContext): Promise<boolean> {
  return (await db.$count(batteryLevel, eq(batteryLevel.householdId, ctx.householdId))) > 0;
}

/** Niveaux de la batterie reçus un jour local, dans l'ordre. */
export async function dayBatteryLevels(
  ctx: HouseholdContext,
  day: string,
): Promise<{ at: Date; percent: number }[]> {
  return db
    .select({ at: batteryLevel.measuredAt, percent: batteryLevel.socPercent })
    .from(batteryLevel)
    .where(
      and(
        eq(batteryLevel.householdId, ctx.householdId),
        gte(batteryLevel.measuredAt, zonedInstant(day, 0, ctx.timezone)),
        lt(batteryLevel.measuredAt, zonedInstant(addDays(day, 1), 0, ctx.timezone)),
      ),
    )
    .orderBy(asc(batteryLevel.measuredAt));
}

/** Valeurs au-delà du seuil de plausibilité de leur compteur, les plus récentes d'abord. */
export async function suspectValues(ctx: HouseholdContext, limit = 100): Promise<StoredValue[]> {
  // Préfiltre au plus petit seuil (batterie : 20 kWh/h), puis seuil exact par compteur.
  const rows = await db
    .select(columns)
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        or(
          and(
            eq(energyInterval.granularity, "hour"),
            gt(energyInterval.kwh, valueCap("battery_charge", "hour")),
          ),
          and(
            eq(energyInterval.granularity, "day"),
            gt(energyInterval.kwh, valueCap("battery_charge", "day")),
          ),
        ),
      ),
    )
    .orderBy(desc(energyInterval.start))
    .limit(limit * 10);
  return rows.filter((r) => isSuspect(r.metric, r.granularity, r.kwh)).slice(0, limit);
}

/** Valeurs d'un compteur sur un jour local (24 heures, ou le total du jour). */
export async function dayValues(
  ctx: HouseholdContext,
  metric: string,
  day: string,
): Promise<StoredValue[]> {
  return db
    .select(columns)
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        eq(energyInterval.metric, metric),
        gte(energyInterval.start, zonedInstant(day, 0, ctx.timezone)),
        lt(energyInterval.start, zonedInstant(addDays(day, 1), 0, ctx.timezone)),
      ),
    )
    .orderBy(asc(energyInterval.start), asc(energyInterval.tariffSlot));
}

/** Corrige une valeur : elle passe en source « manuel ». Refuse l'invraisemblable. */
export async function setValue(ctx: HouseholdContext, key: ValueKey, kwh: number) {
  if (!Number.isFinite(kwh) || kwh < 0) throw new DataError("valeur positive attendue");
  const cap = valueCap(key.metric, key.granularity);
  if (kwh > cap) {
    throw new DataError(`valeur invraisemblable : ${cap} kWh au plus pour ce compteur`);
  }
  const [row] = await db
    .update(energyInterval)
    .set({ kwh, source: "manual" })
    .where(keyOf(ctx, key))
    .returning(columns);
  return row ?? null;
}

export async function deleteValue(ctx: HouseholdContext, key: ValueKey): Promise<boolean> {
  const rows = await db.delete(energyInterval).where(keyOf(ctx, key)).returning(columns);
  return rows.length > 0;
}

function rangeWhere(ctx: HouseholdContext, r: RangeInput) {
  if (r.to < r.from) throw new DataError("la fin précède le début");
  return and(
    eq(energyInterval.householdId, ctx.householdId),
    r.metric === null ? undefined : eq(energyInterval.metric, r.metric),
    gte(energyInterval.start, zonedInstant(r.from, 0, ctx.timezone)),
    lt(energyInterval.start, zonedInstant(addDays(r.to, 1), 0, ctx.timezone)),
  );
}

/** Aperçu d'une suppression : nombre de valeurs et énergie concernée. */
export async function rangeSummary(ctx: HouseholdContext, r: RangeInput) {
  const [row] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      kwh: sum(energyInterval.kwh).mapWith(Number),
    })
    .from(energyInterval)
    .where(rangeWhere(ctx, r));
  return { count: row?.count ?? 0, kwh: row?.kwh ?? 0 };
}

/** Supprime les valeurs d'une plage ; rend le nombre supprimé. */
export async function deleteRange(ctx: HouseholdContext, r: RangeInput): Promise<number> {
  const rows = await db
    .delete(energyInterval)
    .where(rangeWhere(ctx, r))
    .returning({ metric: energyInterval.metric });
  return rows.length;
}
