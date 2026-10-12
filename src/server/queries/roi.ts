import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { energyInterval, household, weatherDaily } from "@/db/schema";
import { batteryGaps, type BatteryGap, type BatteryMonth } from "@/domain/battery-data";
import { payback, type Payback } from "@/domain/roi/payback";
import { batterySavings, solarSavings, type EnergySlot, type Savings } from "@/domain/roi/savings";
import { monthlyYields, yieldDeviation } from "@/domain/roi/yield";
import { currentContract, latestGrid } from "@/domain/tariff/timeline";
import { cellOf, radiationKwhM2 } from "@/domain/weather";
import { addDays, localParts, zonedInstant } from "@/lib/time";
import type { HouseholdContext } from "../context";
import { listContracts } from "../contracts";
import { listEquipment, type Equipment, type EquipmentKind } from "../equipment";
import { pricingDays } from "../calendars";

// Écran Rentabilité (T30) : économies depuis l'installation (contrat actuel, kWh évité au
// créneau), amortissement projeté, rendement solaire normalisé du dernier mois complet.

const METRICS = [
  "solar_production",
  "grid_export",
  "battery_charge",
  "battery_charge_grid",
  "battery_discharge",
] as const;

export interface EquipmentRoi {
  equipment: Equipment;
  savings: Savings;
  payback: Payback;
  /** Première donnée prise en compte (après l'installation), null sans donnée. */
  dataFrom: string | null;
  /** Batterie : mois avec charge sans décharge, ou l'inverse (vide pour le solaire). */
  gaps: BatteryGap[];
}

export interface RoiView {
  items: Partial<Record<EquipmentKind, EquipmentRoi>>;
  /** Aucun contrat actuel : les kWh évités ne sont pas valorisés. */
  noContract: boolean;
  settings: { exportEnabled: boolean; batteryGridCharging: boolean };
  /** Rendement du dernier mois complet comparé à la médiane des 12 mois précédents. */
  solarYield: {
    month: string;
    yield: number;
    reference: number;
    deviation: number;
    alert: boolean;
  } | null;
  today: string;
}

/** Énergie par intervalle depuis `from`, une ligne par heure (ou par jour) reçue. */
async function energySlots(ctx: HouseholdContext, from: string, to: string) {
  const rows = await db
    .select({
      metric: energyInterval.metric,
      start: energyInterval.start,
      granularity: energyInterval.granularity,
      kwh: energyInterval.kwh,
    })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, ctx.householdId),
        inArray(energyInterval.metric, [...METRICS]),
        gte(energyInterval.start, zonedInstant(from, 0, ctx.timezone)),
        lt(energyInterval.start, zonedInstant(to, 0, ctx.timezone)),
      ),
    )
    .orderBy(asc(energyInterval.start));
  const slots = new Map<string, EnergySlot>();
  for (const r of rows) {
    const key = `${r.granularity}|${r.start.toISOString()}`;
    let slot = slots.get(key);
    if (!slot) {
      slot = {
        interval:
          r.granularity === "hour"
            ? { granularity: "hour", start: r.start }
            : { granularity: "day", date: localParts(r.start, ctx.timezone).date },
        solar: 0,
        gridExport: 0,
        batteryCharge: 0,
        batteryChargeGrid: 0,
        batteryDischarge: 0,
      };
      slots.set(key, slot);
    }
    if (r.metric === "solar_production") slot.solar += r.kwh;
    else if (r.metric === "grid_export") slot.gridExport += r.kwh;
    else if (r.metric === "battery_charge") slot.batteryCharge += r.kwh;
    else if (r.metric === "battery_charge_grid") slot.batteryChargeGrid += r.kwh;
    else slot.batteryDischarge += r.kwh;
  }
  return [...slots.values()];
}

const slotDay = (s: EnergySlot, tz: string) =>
  s.interval.granularity === "day" ? s.interval.date : localParts(s.interval.start, tz).date;

/** Charge et décharge de la batterie par mois local. */
function byMonth(slots: readonly EnergySlot[], tz: string): BatteryMonth[] {
  const months = new Map<string, BatteryMonth>();
  for (const x of slots) {
    const month = slotDay(x, tz).slice(0, 7);
    const m = months.get(month) ?? { month, charge: 0, discharge: 0 };
    m.charge += x.batteryCharge;
    m.discharge += x.batteryDischarge;
    months.set(month, m);
  }
  return [...months.values()];
}

export async function getRoi(ctx: HouseholdContext, now = new Date()): Promise<RoiView> {
  const tz = ctx.timezone;
  const today = localParts(now, tz).date;
  const end = addDays(today, 1);
  const [equipmentList, contracts, home] = await Promise.all([
    listEquipment(ctx),
    listContracts(ctx),
    db
      .select({ location: household.location })
      .from(household)
      .where(eq(household.id, ctx.householdId)),
  ]);
  const current = currentContract(contracts, today);
  const contract = current ? latestGrid(current) : null;
  const s = ctx.settings;

  // Une seule lecture depuis l'installation la plus ancienne (et au moins 13 mois pour
  // le rendement de référence).
  const yieldFrom = `${addDays(today, -400).slice(0, 7)}-01`;
  const from = [...equipmentList.map((e) => e.installedOn), yieldFrom].sort()[0] ?? yieldFrom;
  const slots = await energySlots(ctx, from, end);
  const { calendars } = await pricingDays(ctx.householdId, addDays(from, -1), end);
  const options = {
    contract,
    timezone: tz,
    ...calendars,
    exportEnabled: s.exportEnabled,
    exportPriceEurKwh: s.exportPriceEurKwh,
    batteryGridCharging: s.batteryGridCharging,
  };

  const items: RoiView["items"] = {};
  for (const e of equipmentList) {
    const own = slots.filter((x) => slotDay(x, tz) >= e.installedOn);
    const savings = e.kind === "solar" ? solarSavings(own, options) : batterySavings(own, options);
    const first = own[0];
    items[e.kind] = {
      equipment: e,
      savings,
      payback: payback({
        costEur: e.costEur,
        byMonth: savings.byMonth,
        currentMonth: today.slice(0, 7),
        today,
      }),
      dataFrom: first ? slotDay(first, tz) : null,
      gaps: e.kind === "battery" ? batteryGaps(byMonth(own, tz)) : [],
    };
  }

  // Rendement : production du jour ÷ irradiation de la commune, par mois.
  let solarYield: RoiView["solarYield"] = null;
  const location = home[0]?.location ?? null;
  if (location && items.solar) {
    const cell = cellOf(location);
    const weather = await db
      .select({ date: weatherDaily.date, radiation: weatherDaily.radiationMjM2 })
      .from(weatherDaily)
      .where(
        and(
          eq(weatherDaily.latE2, cell.latE2),
          eq(weatherDaily.lonE2, cell.lonE2),
          gte(weatherDaily.date, yieldFrom),
          lt(weatherDaily.date, end),
        ),
      );
    const production = new Map<string, number>();
    for (const x of slots) {
      const d = slotDay(x, tz);
      if (d >= yieldFrom) production.set(d, (production.get(d) ?? 0) + x.solar);
    }
    // Seulement les jours où la production a été reçue (sinon 0 kWh fausserait la référence).
    const yields = monthlyYields(
      weather
        .filter((w) => production.has(w.date))
        .map((w) => ({
          date: w.date,
          kwh: production.get(w.date) ?? 0,
          radiationKwhM2: radiationKwhM2(w.radiation),
        })),
    );
    // Dernier mois complet : celui qui précède le mois en cours.
    const lastComplete = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const d = yieldDeviation(yields, lastComplete);
    solarYield = d ? { month: lastComplete, ...d } : null;
  }

  return {
    items,
    noContract: contract === null,
    settings: { exportEnabled: s.exportEnabled, batteryGridCharging: s.batteryGridCharging },
    solarYield,
    today,
  };
}
