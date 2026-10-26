import { localParts } from "@/lib/time";
import type { WeatherHour } from "../weather";

// Production solaire prévue (T68, SPEC §7.14). Le rendement du foyer (kWh produits pour
// 1 kWh/m² de rayonnement global reçu) est appris pour chaque heure locale de la journée sur
// les 60 derniers jours : il capte l'orientation, l'inclinaison et les ombres sans rien
// demander. Faute d'historique, puissance installée × 0,8 (rendement global usuel). Pur.

/** Jours de production nécessaires pour apprendre le rendement. */
const MIN_DAYS = 14;
/** Rayonnement en dessous duquel une heure n'apprend rien (aube, crépuscule). */
const MIN_RADIATION_WM2 = 50;
/** Heures retenues nécessaires pour une heure de la journée ; sinon le rendement moyen. */
const MIN_SAMPLES = 10;
/** kWh produits par kWc et par kWh/m² reçu, faute d'historique. */
const PERFORMANCE_RATIO = 0.8;

export interface SolarYield {
  /** « learned » : appris sur l'historique ; « kwc » : estimé depuis la puissance installée. */
  method: "learned" | "kwc";
  /** kWh produits par kWh/m² reçu, pour chaque heure locale 0–23. */
  byHour: number[];
}

export function learnSolarYield(input: {
  /** Production horaire mesurée (début de l'heure UTC). */
  production: readonly { start: Date; kwh: number }[];
  /** Rayonnement horaire des mêmes jours. */
  weather: readonly WeatherHour[];
  timezone: string;
  /** Puissance installée (kWc), null si inconnue. */
  kwc: number | null;
}): SolarYield | null {
  const produced = new Map(input.production.map((p) => [p.start.getTime(), p.kwh]));
  const days = new Set(
    input.production.filter((p) => p.kwh > 0).map((p) => localParts(p.start, input.timezone).date),
  );
  if (days.size < MIN_DAYS) {
    return input.kwc
      ? { method: "kwc", byHour: Array(24).fill(input.kwc * PERFORMANCE_RATIO) }
      : null;
  }

  const kwh = Array<number>(24).fill(0);
  const received = Array<number>(24).fill(0);
  const samples = Array<number>(24).fill(0);
  for (const w of input.weather) {
    const p = produced.get(w.start.getTime());
    if (p === undefined || w.radiationWm2 === null || w.radiationWm2 < MIN_RADIATION_WM2) continue;
    const h = localParts(w.start, input.timezone).hour;
    kwh[h] = (kwh[h] ?? 0) + p;
    received[h] = (received[h] ?? 0) + w.radiationWm2 / 1000;
    samples[h] = (samples[h] ?? 0) + 1;
  }
  const totalReceived = received.reduce((a, b) => a + b, 0);
  if (totalReceived === 0) {
    return input.kwc
      ? { method: "kwc", byHour: Array(24).fill(input.kwc * PERFORMANCE_RATIO) }
      : null;
  }
  const average = kwh.reduce((a, b) => a + b, 0) / totalReceived;
  return {
    method: "learned",
    byHour: kwh.map((k, h) =>
      (samples[h] ?? 0) >= MIN_SAMPLES ? k / (received[h] as number) : average,
    ),
  };
}

/** Production prévue de chaque heure (kWh) ; une heure sans rayonnement prévu compte 0. */
export function forecastSolar(
  hours: readonly WeatherHour[],
  yieldByHour: SolarYield,
  timezone: string,
): { start: Date; kwh: number }[] {
  return hours.map((w) => ({
    start: w.start,
    kwh:
      ((w.radiationWm2 ?? 0) / 1000) *
      (yieldByHour.byHour[localParts(w.start, timezone).hour] ?? 0),
  }));
}
