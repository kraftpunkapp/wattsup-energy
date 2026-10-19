import { and, asc, eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  category,
  contract,
  contractPeriod,
  energyInterval,
  equipment,
  fuelEvent,
  household,
  idea,
  ingestLog,
  marker,
  sobrietyOverride,
  tempoOverride,
  user,
} from "@/db/schema";
import { ENERGY_CSV_HEADER, energyCsvLine, type EnergyRow } from "@/domain/export";
import type { HouseholdContext } from "./context";

// Export de mes données (T46) : l'énergie en CSV réimportable, tout le reste en JSON. Jamais
// de token, de hash, de session ni de mot de passe. Chaque requête filtre par le foyer (ou le
// compte) du contexte.

const BATCH = 10_000;

/**
 * Lignes CSV de l'énergie, en-tête compris, par lots (2 millions de valeurs au plus par
 * foyer : on ne charge jamais tout en mémoire). Pagination par clé (start, metric,
 * granularity, tariff_slot), l'ordre de la clé primaire.
 */
export async function* energyCsvChunks(
  ctx: HouseholdContext,
  batch = BATCH,
): AsyncGenerator<string> {
  yield `${ENERGY_CSV_HEADER}\n`;
  let after: EnergyRow | null = null;
  for (;;) {
    const last: EnergyRow | null = after;
    const rows: EnergyRow[] = await db
      .select({
        start: energyInterval.start,
        granularity: energyInterval.granularity,
        metric: energyInterval.metric,
        kwh: energyInterval.kwh,
        tariffSlot: energyInterval.tariffSlot,
      })
      .from(energyInterval)
      .where(
        and(
          eq(energyInterval.householdId, ctx.householdId),
          last
            ? sql`(${energyInterval.start}, ${energyInterval.metric}, ${energyInterval.granularity}, ${energyInterval.tariffSlot}) > (${last.start.toISOString()}::timestamptz, ${last.metric}, ${last.granularity}::interval_granularity, ${last.tariffSlot})`
            : undefined,
        ),
      )
      .orderBy(
        asc(energyInterval.start),
        asc(energyInterval.metric),
        asc(energyInterval.granularity),
        asc(energyInterval.tariffSlot),
      )
      .limit(batch);
    if (rows.length === 0) return;
    yield `${rows.map((r) => energyCsvLine(r, ctx.timezone)).join("\n")}\n`;
    after = rows.at(-1) ?? null;
    if (rows.length < batch) return;
  }
}

/** Tout le reste, en JSON lisible : compte, foyer, réglages, postes, contrats, etc. */
export async function exportData(ctx: HouseholdContext, now = new Date()) {
  const mine = (column: AnyPgColumn) => eq(column, ctx.householdId);
  const [
    account,
    home,
    categories,
    contracts,
    periods,
    fuel,
    equipments,
    markers,
    tempo,
    sobriety,
    log,
    ideas,
  ] = await Promise.all([
    db
      .select({ name: user.name, email: user.email, createdAt: user.createdAt, theme: user.theme })
      .from(user)
      .where(eq(user.id, ctx.userId)),
    db
      .select({
        name: household.name,
        timezone: household.timezone,
        granularity: household.granularity,
        profile: household.profile,
        settings: household.settings,
        location: household.location,
        createdAt: household.createdAt,
      })
      .from(household)
      .where(eq(household.id, ctx.householdId)),
    db
      .select({
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        color: category.color,
        isHeating: category.isHeating,
      })
      .from(category)
      .where(mine(category.householdId)),
    db
      .select({
        id: contract.id,
        name: contract.name,
        kind: contract.kind,
        status: contract.status,
        startDate: contract.startDate,
        endDate: contract.endDate,
        monthlyPaymentCents: contract.monthlyPaymentCents,
        paymentsPerYear: contract.paymentsPerYear,
        settlementMonth: contract.settlementMonth,
      })
      .from(contract)
      .where(mine(contract.householdId)),
    db
      .select({
        contractId: contractPeriod.contractId,
        validFrom: contractPeriod.validFrom,
        config: contractPeriod.config,
      })
      .from(contractPeriod)
      .where(mine(contractPeriod.householdId))
      .orderBy(asc(contractPeriod.validFrom)),
    db
      .select({
        fuel: fuelEvent.fuel,
        type: fuelEvent.type,
        at: fuelEvent.at,
        qty: fuelEvent.qty,
        unit: fuelEvent.unit,
        priceEur: fuelEvent.priceEur,
      })
      .from(fuelEvent)
      .where(mine(fuelEvent.householdId))
      .orderBy(asc(fuelEvent.at)),
    db
      .select({
        kind: equipment.kind,
        label: equipment.label,
        capacity: equipment.capacity,
        installedOn: equipment.installedOn,
        costEur: equipment.costEur,
      })
      .from(equipment)
      .where(mine(equipment.householdId)),
    db
      .select({
        kind: marker.kind,
        text: marker.text,
        startDate: marker.startDate,
        endDate: marker.endDate,
      })
      .from(marker)
      .where(mine(marker.householdId))
      .orderBy(asc(marker.startDate)),
    db
      .select({
        date: tempoOverride.date,
        color: tempoOverride.color,
        source: tempoOverride.source,
      })
      .from(tempoOverride)
      .where(mine(tempoOverride.householdId))
      .orderBy(asc(tempoOverride.date)),
    db
      .select({ date: sobrietyOverride.date, sobriety: sobrietyOverride.sobriety })
      .from(sobrietyOverride)
      .where(mine(sobrietyOverride.householdId))
      .orderBy(asc(sobrietyOverride.date)),
    db
      .select({
        receivedAt: ingestLog.receivedAt,
        httpStatus: ingestLog.httpStatus,
        mode: ingestLog.mode,
        warnings: ingestLog.warnings,
        error: ingestLog.error,
      })
      .from(ingestLog)
      .where(mine(ingestLog.householdId))
      .orderBy(asc(ingestLog.receivedAt)),
    db
      .select({
        title: idea.title,
        description: idea.description,
        status: idea.status,
        version: idea.version,
        createdAt: idea.createdAt,
      })
      .from(idea)
      .where(eq(idea.authorId, ctx.userId)),
  ]);
  return {
    format: "wattsup-export",
    version: 1,
    exportedAt: now.toISOString(),
    note: "Énergie : fichier CSV séparé, au format de l'import CSV (Réglages › Données).",
    account: account[0] ?? null,
    household: home[0] ?? null,
    categories,
    contracts: contracts.map(({ id, ...c }) => ({
      ...c,
      periods: periods
        .filter((p) => p.contractId === id)
        .map(({ validFrom, config }) => ({ validFrom, config })),
    })),
    fuelEvents: fuel,
    equipment: equipments,
    markers,
    tempoOverrides: tempo,
    sobrietyOverrides: sobriety,
    ingestLog: log,
    ideas,
  };
}
