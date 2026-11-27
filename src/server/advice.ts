import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { energyInterval } from "@/db/schema";
import { consumptionAdvice, surplusWindow, type Advice } from "@/domain/advice";
import { currentContract, gridAt } from "@/domain/tariff/timeline";
import { addDays, localParts, zonedInstant } from "@/lib/time";
import type { HouseholdContext } from "./context";
import { listContracts } from "./contracts";
import { tempoColorsFor } from "./tempo/sync";

// « Quand consommer » (T48) : surplus solaire habituel, heures creuses du contrat en cours,
// couleur Tempo de demain. Filtré par ctx.householdId.

const PROFILE_DAYS = 30;

/** Export moyen par heure locale sur les 30 derniers jours (jours avec export reçu). */
async function exportProfile(ctx: HouseholdContext, today: string) {
  const local = sql`(${energyInterval.start} at time zone ${ctx.timezone})`;
  const rows = await db
    .select({
      hour: sql<number>`extract(hour from ${local})::int`,
      kwh: sql<number>`sum(${energyInterval.kwh})`.mapWith(Number),
      days: sql<number>`count(distinct date(${local}))::int`,
    })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        eq(energyInterval.metric, "grid_export"),
        eq(energyInterval.granularity, "hour"),
        gte(energyInterval.start, zonedInstant(addDays(today, -PROFILE_DAYS), 0, ctx.timezone)),
        lt(energyInterval.start, zonedInstant(today, 0, ctx.timezone)),
      ),
    )
    .groupBy(sql`1`);
  return rows.map((r) => ({ hour: r.hour, exportKwh: r.days > 0 ? r.kwh / r.days : 0 }));
}

export async function getAdvice(ctx: HouseholdContext, now = new Date()): Promise<Advice[]> {
  const today = localParts(now, ctx.timezone).date;
  const tomorrow = addDays(today, 1);
  const [profile, contracts] = await Promise.all([
    ctx.profile.solar ? exportProfile(ctx, today) : Promise.resolve([]),
    listContracts(ctx),
  ]);
  const current = currentContract(contracts, today);
  const contract = current ? gridAt(current, today) : null;
  const color =
    contract?.kind === "tempo"
      ? ((await tempoColorsFor(ctx.householdId, tomorrow, addDays(tomorrow, 1))).get(tomorrow) ??
        null)
      : null;
  return consumptionAdvice({
    date: today,
    surplus: surplusWindow(profile),
    contract,
    tomorrow: contract?.kind === "tempo" ? { color } : null,
  });
}
