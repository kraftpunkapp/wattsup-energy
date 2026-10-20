import type { MeterReading } from "./hourly";
import type { DailyPayload, HourlyPayload } from "./schema";
import type { CoreMetric, IngestWarning, Metric } from "./types";

// Passage d'un payload validé aux structures du domaine : index (horaire) ou
// intervalles journaliers (quotidien). Les catégories inconnues du foyer sont écartées.

export type TariffSlot = "hp" | "hc";

export interface DailyInterval {
  metric: Metric;
  /** Jour local du foyer, AAAA-MM-JJ. */
  date: string;
  slot: TariffSlot | null;
  kwh: number;
}

const HOURLY_ENERGY_KEYS = {
  grid_import_kwh: "grid_import",
  grid_export_kwh: "grid_export",
  solar_production_kwh: "solar_production",
  battery_charge_kwh: "battery_charge",
  battery_charge_grid_kwh: "battery_charge_grid",
  battery_discharge_kwh: "battery_discharge",
} as const satisfies Record<string, CoreMetric>;

const DAILY_ENERGY_KEYS = {
  grid_export_kwh: "grid_export",
  solar_production_kwh: "solar_production",
  battery_charge_kwh: "battery_charge",
  battery_charge_grid_kwh: "battery_charge_grid",
  battery_discharge_kwh: "battery_discharge",
} as const satisfies Record<string, CoreMetric>;

function knownCategories(
  categories: Record<string, number> | undefined,
  knownSlugs: readonly string[],
): { entries: [Metric, number][]; warnings: IngestWarning[] } {
  const known = new Set(knownSlugs);
  const entries: [Metric, number][] = [];
  const warnings: IngestWarning[] = [];
  for (const [slug, value] of Object.entries(categories ?? {})) {
    if (known.has(slug)) entries.push([`category:${slug}`, value]);
    else warnings.push({ code: "unknown_category", key: slug });
  }
  return { entries, warnings };
}

export function hourlyReadings(
  payload: HourlyPayload,
  knownSlugs: readonly string[],
): { readings: MeterReading[]; warnings: IngestWarning[] } {
  const readings: MeterReading[] = [];
  for (const [key, metric] of Object.entries(HOURLY_ENERGY_KEYS)) {
    const value = payload.energy?.[key as keyof typeof HOURLY_ENERGY_KEYS];
    if (value !== undefined) readings.push({ metric, ts: payload.ts, value });
  }
  const cats = knownCategories(payload.categories, knownSlugs);
  for (const [metric, value] of cats.entries) readings.push({ metric, ts: payload.ts, value });
  const warnings = [...cats.warnings];
  if (readings.length === 0) warnings.push({ code: "no_energy_data" });
  else if (!readings.some((r) => r.metric === "grid_import")) {
    warnings.push({ code: "missing_grid_import" });
  }
  return { readings, warnings };
}

export function dailyToIntervals(
  payload: DailyPayload,
  knownSlugs: readonly string[],
): { intervals: DailyInterval[]; warnings: IngestWarning[] } {
  const { date } = payload;
  const intervals: DailyInterval[] = [];
  const push = (metric: Metric, kwh: number, slot: TariffSlot | null = null) =>
    intervals.push({ metric, date, slot, kwh });

  const grid = payload.grid_import;
  if (grid && "kwh" in grid) push("grid_import", grid.kwh);
  if (grid && "hp_kwh" in grid) {
    push("grid_import", grid.hp_kwh, "hp");
    push("grid_import", grid.hc_kwh, "hc");
  }
  for (const [key, metric] of Object.entries(DAILY_ENERGY_KEYS)) {
    const value = payload[key as keyof typeof DAILY_ENERGY_KEYS];
    if (value !== undefined) push(metric, value);
  }
  const cats = knownCategories(payload.categories, knownSlugs);
  for (const [metric, value] of cats.entries) push(metric, value);

  const warnings = [...cats.warnings];
  if (intervals.length === 0) warnings.push({ code: "no_energy_data" });
  else if (!grid) warnings.push({ code: "missing_grid_import" });
  return { intervals, warnings };
}
