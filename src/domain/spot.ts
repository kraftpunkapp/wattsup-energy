import { z } from "zod";
import { addDays } from "@/lib/time";

// Prix spot EPEX France (T58, SPEC §7.12) : réponse d'energy-charts.info (`/price?bzn=FR`),
// des instants (secondes Unix) et des prix en €/MWh, au pas horaire puis quart-horaire depuis
// l'automne 2025. WattsUp garde la moyenne de chaque heure UTC, comme ses données d'énergie.

const responseSchema = z.object({
  unix_seconds: z.array(z.number().int()),
  price: z.array(z.number().nullable()),
});

export interface SpotHour {
  start: Date;
  eurMwh: number;
}

export function hourlyAverages(body: unknown): SpotHour[] {
  const r = responseSchema.safeParse(body);
  if (!r.success || r.data.unix_seconds.length !== r.data.price.length) {
    throw new Error("réponse d'energy-charts.info inattendue");
  }
  const hours = new Map<number, { sum: number; n: number }>();
  r.data.unix_seconds.forEach((t, i) => {
    const price = r.data.price[i];
    if (price === null || price === undefined) return;
    const hour = Math.floor(t / 3600) * 3600;
    const acc = hours.get(hour) ?? { sum: 0, n: 0 };
    acc.sum += price;
    acc.n += 1;
    hours.set(hour, acc);
  });
  return [...hours]
    .sort(([a], [b]) => a - b)
    .map(([hour, { sum, n }]) => ({
      start: new Date(hour * 1000),
      eurMwh: Math.round((sum / n) * 100) / 100,
    }));
}

/** Période [from, to] (jours, fin incluse) découpée par `months` mois calendaires, une requête chacun. */
export function spotChunks(from: string, to: string, months = 6): [string, string][] {
  const out: [string, string][] = [];
  let start = from;
  while (start <= to) {
    const [y, m] = start.split("-").map(Number) as [number, number];
    const next = m - 1 + months;
    const end0 = addDays(
      `${y + Math.floor(next / 12)}-${String((next % 12) + 1).padStart(2, "0")}-01`,
      -1,
    );
    const end = end0 < to ? end0 : to;
    out.push([start, end]);
    start = addDays(end, 1);
  }
  return out;
}
