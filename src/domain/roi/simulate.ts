import { priceIntervals } from "../tariff/engine";
import type { Contract, PriceableInterval, TempoColor } from "../tariff/types";

// Simulateur « Et si… » (SPEC §9, Rentabilité, T45) : rejoue heure par heure les échanges
// réels du foyer avec des panneaux en plus et/ou une batterie de plus. Pur.
//
// - Panneaux : production supplémentaire proportionnelle à la production réelle (même
//   orientation, même ombrage) ; elle couvre d'abord les achats de l'heure, le reste part au
//   réseau.
// - Batterie : elle se charge du surplus qui partait au réseau et se décharge sur les achats,
//   dans la limite de sa capacité utile et de sa puissance ; le rendement aller-retour
//   s'applique à la décharge. Elle part vide. Une heure qui a à la fois de l'export et de
//   l'import charge avant de décharger.

export interface HourFlow {
  start: Date;
  gridImport: number;
  gridExport: number;
  /** Production solaire réelle de l'heure (profil des panneaux ajoutés). */
  solar: number;
}

export interface SimulationOptions {
  /** kWc ajoutés, et kWc déjà installés (pour l'échelle de production). */
  addKwc?: number;
  currentKwc?: number | null;
  battery?: { capacityKwh: number; powerKw: number; efficiency: number } | null;
}

export interface SimulationResult {
  /** Achats et revente de chaque heure après simulation. */
  hours: { start: Date; gridImport: number; gridExport: number }[];
  totals: {
    importBefore: number;
    importAfter: number;
    exportBefore: number;
    exportAfter: number;
    /** Production des panneaux ajoutés. */
    extraSolar: number;
    batteryIn: number;
    batteryOut: number;
    /** Part de la production consommée sur place (null sans production). */
    selfConsumptionBefore: number | null;
    selfConsumptionAfter: number | null;
  };
}

export function simulate(hours: readonly HourFlow[], o: SimulationOptions): SimulationResult {
  const scale = o.addKwc && o.currentKwc && o.currentKwc > 0 ? o.addKwc / o.currentKwc : 0;
  const b = o.battery && o.battery.capacityKwh > 0 && o.battery.powerKw > 0 ? o.battery : null;
  let soc = 0;
  const t = {
    importBefore: 0,
    importAfter: 0,
    exportBefore: 0,
    exportAfter: 0,
    extraSolar: 0,
    batteryIn: 0,
    batteryOut: 0,
  };
  let solar = 0;
  const out = hours.map((h) => {
    let gridImport = h.gridImport;
    let gridExport = h.gridExport;
    const extra = h.solar * scale;
    const used = Math.min(extra, gridImport);
    gridImport -= used;
    gridExport += extra - used;
    if (b) {
      const charge = Math.min(gridExport, b.powerKw, b.capacityKwh - soc);
      soc += charge;
      gridExport -= charge;
      const discharge = Math.min(gridImport, b.powerKw, soc * b.efficiency);
      soc -= discharge / b.efficiency;
      gridImport -= discharge;
      t.batteryIn += charge;
      t.batteryOut += discharge;
    }
    t.importBefore += h.gridImport;
    t.exportBefore += h.gridExport;
    t.importAfter += gridImport;
    t.exportAfter += gridExport;
    t.extraSolar += extra;
    solar += h.solar;
    return { start: h.start, gridImport, gridExport };
  });
  const before = solar > 0 ? 1 - t.exportBefore / solar : null;
  const produced = solar + t.extraSolar;
  // La revente évitée par la batterie compte comme consommée sur place (restituée plus tard).
  const after = produced > 0 ? 1 - t.exportAfter / produced : null;
  return {
    hours: out,
    totals: { ...t, selfConsumptionBefore: before, selfConsumptionAfter: after },
  };
}

/**
 * Économie de la simulation en centimes : achats évités au prix du contrat actuel (créneau de
 * chaque heure), moins la revente perdue (ou plus la revente gagnée) au prix de revente si
 * elle est activée.
 */
export function simulationSavings(
  before: readonly HourFlow[],
  after: SimulationResult["hours"],
  o: {
    contract: Contract;
    timezone: string;
    tempoColor?: (day: string) => TempoColor | undefined;
    sobrietyDay?: (day: string) => boolean;
    exportPriceEurKwh: number | null;
  },
): number {
  const energy = (list: readonly { start: Date; gridImport: number }[]) =>
    priceIntervals(
      list
        .filter((h) => h.gridImport > 0)
        .map((h): PriceableInterval => ({
          granularity: "hour",
          start: h.start,
          kwh: h.gridImport,
        })),
      o.contract,
      // L'abonnement ne change pas : seule l'énergie compte.
      {
        timezone: o.timezone,
        period: { from: "2000-01-01", to: "2000-01-01" },
        tempoColor: o.tempoColor,
        sobrietyDay: o.sobrietyDay,
      },
    ).energyCents;
  const exported = (list: readonly { gridExport: number }[]) =>
    list.reduce((a, h) => a + h.gridExport, 0);
  const resale =
    o.exportPriceEurKwh !== null
      ? (exported(after) - exported(before)) * o.exportPriceEurKwh * 100
      : 0;
  return Math.round(energy(before) - energy(after) + resale);
}
