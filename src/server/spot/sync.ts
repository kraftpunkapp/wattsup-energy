import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { spotPrice } from "@/db/schema";
import { spotChunks } from "@/domain/spot";
import { addDays, localParts } from "@/lib/time";
import type { SpotSource } from "./source";

// Prix spot globaux (T58) : historique depuis janvier 2023, puis chaque jour les deux
// derniers jours et le lendemain (prix publiés vers 13 h). energy-charts.info limite le débit :
// une pause sépare deux requêtes, et le premier mois en échec arrête le passage, repris au
// suivant depuis le dernier jour connu (sans trou).

export const spotSyncEnabled = () => process.env.SPOT_SYNC !== "off";

const HISTORY_FROM = "2023-01-01";
const BATCH = 2000;
const PAUSE_MS = 3000;

export async function syncSpot(
  source: SpotSource,
  now = new Date(),
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
) {
  const [last] = await db
    .select({ start: spotPrice.start })
    .from(spotPrice)
    .orderBy(desc(spotPrice.start))
    .limit(1);
  const tomorrow = addDays(localParts(now, "Europe/Paris").date, 1);
  const resume = last ? addDays(localParts(last.start, "Europe/Paris").date, -2) : HISTORY_FROM;
  // Un jour sans aucun prix avant la reprise (trou laissé par une panne) : repris d'abord.
  const [gap] = last
    ? await db.execute<{ day: string | null }>(sql`
        select min(d)::date::text as day
        from generate_series(${HISTORY_FROM}::date, ${resume}::date, interval '1 day') as d
        where not exists (
          select 1 from ${spotPrice}
          where ${spotPrice.start} >= d and ${spotPrice.start} < d + interval '1 day'
        )`)
    : [];
  const from = gap?.day && gap.day < resume ? gap.day : resume;
  let hours = 0;
  const failed: string[] = [];
  for (const [i, [a, b]] of spotChunks(from, tomorrow).entries()) {
    if (i > 0) await pause(PAUSE_MS);
    try {
      const rows = await source.prices(a, b);
      for (let i = 0; i < rows.length; i += BATCH) {
        await db
          .insert(spotPrice)
          .values(rows.slice(i, i + BATCH))
          .onConflictDoUpdate({
            target: spotPrice.start,
            set: { eurMwh: sql`excluded.eur_mwh`, fetchedAt: sql`now()` },
          });
      }
      hours += rows.length;
    } catch {
      failed.push(a.slice(0, 7));
      break;
    }
  }
  return { hours, failed };
}
