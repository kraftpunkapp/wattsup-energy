import { localParts } from "@/lib/time";

// Batterie simulée (T69, SPEC §7.14) : le surplus solaire la charge (rendement 90 %), puis
// part au réseau ; elle couvre ensuite la consommation jusqu'à se vider. Faute d'état de
// charge envoyé par Home Assistant, elle est supposée vide à minuit chaque jour. Pur.

const EFFICIENCY = 0.9;
/** Charge à partir de laquelle la batterie compte comme pleine (part de la capacité). */
const FULL = 0.99;

export interface SimulatedHour {
  start: Date;
  solarKwh: number;
  loadKwh: number;
  importKwh: number;
  exportKwh: number;
  /** Énergie stockée en fin d'heure. */
  socKwh: number;
}

export function simulateBattery(
  hours: readonly { start: Date; solarKwh: number; loadKwh: number }[],
  capacityKwh: number,
  timezone: string,
): { hours: SimulatedHour[]; fullAt: { date: string; start: Date }[] } {
  let soc = 0;
  let day = "";
  const fullAt: { date: string; start: Date }[] = [];
  const out = hours.map((x) => {
    const date = localParts(x.start, timezone).date;
    if (date !== day) {
      day = date;
      soc = 0;
    }
    const net = x.solarKwh - x.loadKwh;
    let importKwh = 0;
    let exportKwh = 0;
    if (net >= 0) {
      const charge = Math.min(net, Math.max(0, capacityKwh - soc) / EFFICIENCY);
      soc += charge * EFFICIENCY;
      exportKwh = net - charge;
    } else {
      const discharge = Math.min(-net, soc);
      soc -= discharge;
      importKwh = -net - discharge;
    }
    if (capacityKwh > 0 && soc >= capacityKwh * FULL && fullAt.at(-1)?.date !== date) {
      fullAt.push({ date, start: x.start });
    }
    return { ...x, importKwh, exportKwh, socKwh: soc };
  });
  return { hours: out, fullAt };
}
