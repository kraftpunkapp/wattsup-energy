import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { energyInterval } from "@/db/schema";
import { simulate, simulationSavings, type HourFlow } from "@/domain/roi/simulate";
import { currentContract, latestGrid } from "@/domain/tariff/timeline";
import { addDays, localParts, zonedInstant } from "@/lib/time";
import type { HouseholdContext } from "./context";
import { listContracts } from "./contracts";
import { listEquipment } from "./equipment";
import { pricingDays } from "./calendars";

// Simulateur « Et si… » (T45) : rejoue les 12 derniers mois horaires du foyer avec une
// batterie et/ou des panneaux en plus, au prix du contrat actuel. Filtre par ctx.householdId.

/** Rendement aller-retour d'une batterie domestique lithium. */
export const BATTERY_EFFICIENCY = 0.9;
/** Jours de données horaires nécessaires pour simuler. */
export const MIN_SIMULATION_DAYS = 30;

export interface SimulationRequest {
  battery: { capacityKwh: number; powerKw: number; costEur: number } | null;
  panels: { kwc: number; costEur: number } | null;
}

export type SimulationView =
  | { status: "unavailable"; reason: "no-contract" | "no-data" | "no-solar-capacity"; days: number }
  | {
      status: "ok";
      /** Jours de données rejoués, et leurs bornes. */
      days: number;
      from: string;
      to: string;
      /** Ramené à un an (× 365 / jours). */
      annual: { savingsCents: number; importAvoidedKwh: number; exportChangeKwh: number };
      selfConsumption: { before: number | null; after: number | null };
      /** Années pour rembourser le coût saisi ; null sans économie. */
      paybackYears: number | null;
      costEur: number;
    };

export async function runSimulation(
  ctx: HouseholdContext,
  req: SimulationRequest,
  now = new Date(),
): Promise<SimulationView> {
  const tz = ctx.timezone;
  const today = localParts(now, tz).date;
  const from = addDays(today, -365);
  const [rows, contracts, equipment] = await Promise.all([
    db
      .select({
        metric: energyInterval.metric,
        start: energyInterval.start,
        kwh: energyInterval.kwh,
      })
      .from(energyInterval)
      .where(
        and(
          eq(energyInterval.householdId, ctx.householdId),
          eq(energyInterval.granularity, "hour"),
          inArray(energyInterval.metric, ["grid_import", "grid_export", "solar_production"]),
          gte(energyInterval.start, zonedInstant(from, 0, tz)),
          lt(energyInterval.start, zonedInstant(today, 0, tz)),
        ),
      )
      .orderBy(asc(energyInterval.start)),
    listContracts(ctx),
    listEquipment(ctx),
  ]);

  const byHour = new Map<number, HourFlow>();
  for (const r of rows) {
    const t = r.start.getTime();
    const h = byHour.get(t) ?? { start: r.start, gridImport: 0, gridExport: 0, solar: 0 };
    if (r.metric === "grid_import") h.gridImport += r.kwh;
    else if (r.metric === "grid_export") h.gridExport += r.kwh;
    else h.solar += r.kwh;
    byHour.set(t, h);
  }
  const hours = [...byHour.values()];
  const dates = new Set(hours.map((h) => localParts(h.start, tz).date));
  const days = dates.size;
  const current = currentContract(contracts, today);
  if (!current) return { status: "unavailable", reason: "no-contract", days };
  if (days < MIN_SIMULATION_DAYS) return { status: "unavailable", reason: "no-data", days };
  const currentKwc = equipment.find((e) => e.kind === "solar")?.capacity ?? null;
  if (req.panels && !currentKwc) {
    return { status: "unavailable", reason: "no-solar-capacity", days };
  }

  const result = simulate(hours, {
    addKwc: req.panels?.kwc,
    currentKwc,
    battery: req.battery && { ...req.battery, efficiency: BATTERY_EFFICIENCY },
  });
  const { calendars } = await pricingDays(ctx.householdId, addDays(from, -1), today);
  const savings = simulationSavings(hours, result.hours, {
    contract: latestGrid(current),
    timezone: tz,
    ...calendars,
    exportPriceEurKwh: ctx.settings.exportEnabled ? ctx.settings.exportPriceEurKwh : null,
  });
  const factor = 365 / days;
  const annualSavings = Math.round(savings * factor);
  const costEur = (req.battery?.costEur ?? 0) + (req.panels?.costEur ?? 0);
  const sorted = [...dates].sort();
  return {
    status: "ok",
    days,
    from: sorted[0] ?? from,
    to: sorted.at(-1) ?? today,
    annual: {
      savingsCents: annualSavings,
      importAvoidedKwh: (result.totals.importBefore - result.totals.importAfter) * factor,
      exportChangeKwh: (result.totals.exportAfter - result.totals.exportBefore) * factor,
    },
    selfConsumption: {
      before: result.totals.selfConsumptionBefore,
      after: result.totals.selfConsumptionAfter,
    },
    paybackYears: annualSavings > 0 && costEur > 0 ? costEur / (annualSavings / 100) : null,
    costEur,
  };
}
