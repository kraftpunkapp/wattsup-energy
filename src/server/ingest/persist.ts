import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  batteryState,
  energyInterval,
  household,
  ingestLog,
  meterState,
  tempoOverride,
} from "@/db/schema";
import { indexToIntervals, type MeterReading } from "@/domain/ingest/hourly";
import { dailyToIntervals, hourlyReadings } from "@/domain/ingest/normalize";
import {
  parseIngestPayload,
  type DailyPayload,
  type HourlyPayload,
  type PayloadError,
} from "@/domain/ingest/schema";
import type { IngestWarning } from "@/domain/ingest/types";
import { tempoDay, zonedInstant } from "@/lib/time";

// Persistance d'un push HA (SPEC §6). Données et journal sont écrits dans une seule
// transaction : un push est appliqué entièrement ou pas du tout, en un seul commit.

export type IngestResponse =
  | { status: 200; body: { ok: true; warnings: IngestWarning[] } }
  | { status: 400; body: { ok: false; errors: PayloadError[] } }
  | { status: 409; body: { ok: false; error: string } };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const intervalKey = [
  energyInterval.householdId,
  energyInterval.metric,
  energyInterval.start,
  energyInterval.granularity,
  energyInterval.tariffSlot,
];

export async function ingest(householdId: string, rawBody: string): Promise<IngestResponse> {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return log(householdId, rawBody, null, {
      status: 400,
      body: { ok: false, errors: [{ path: "", message: "JSON invalide" }] },
    });
  }

  const parsed = parseIngestPayload(json);
  if (!parsed.success) {
    return log(householdId, rawBody, null, {
      status: 400,
      body: { ok: false, errors: parsed.errors },
    });
  }

  const payload = parsed.data;
  // Fuseau, granularité et postes du foyer en une seule requête.
  const [home] = await db
    .select({
      timezone: household.timezone,
      granularity: household.granularity,
      // Colonnes qualifiées en clair : dans un fragment sql, Drizzle omet le nom de table et
      // « id » désignerait celui du poste.
      slugs: sql<
        string[]
      >`coalesce((select json_agg(c.slug) from category c where c.household_id = "household"."id"), '[]'::json)`,
    })
    .from(household)
    .where(eq(household.id, householdId));
  if (!home) throw new Error(`foyer inconnu : ${householdId}`);
  if (home.granularity !== payload.kind) {
    const expected =
      home.granularity === "hourly" ? "horaire (champ `ts`)" : "quotidien (champ `date`)";
    return log(householdId, rawBody, payload.kind, {
      status: 409,
      body: {
        ok: false,
        error: `ce foyer attend des envois en mode ${expected} ; changez la granularité dans Réglages ou dans le blueprint`,
      },
    });
  }

  // Données et journal dans la même transaction : un seul commit par push.
  return db.transaction(async (tx) => {
    const warnings =
      payload.kind === "hourly"
        ? await persistHourly(tx, householdId, home.timezone, payload, home.slugs)
        : await persistDaily(tx, householdId, home.timezone, payload, home.slugs);
    if (payload.fuel) warnings.push({ code: "ignored_block", key: "fuel" });
    return log(
      householdId,
      rawBody,
      payload.kind,
      { status: 200, body: { ok: true, warnings } },
      tx,
    );
  });
}

async function persistHourly(
  tx: Tx,
  householdId: string,
  timezone: string,
  payload: HourlyPayload,
  slugs: string[],
): Promise<IngestWarning[]> {
  const { readings, warnings } = hourlyReadings(payload, slugs);
  if (payload.battery_soc_percent !== undefined) {
    await upsertBatteryState(tx, householdId, payload.ts, payload.battery_soc_percent);
  }
  if (readings.length === 0) {
    if (payload.tempo_color) {
      await upsertTempo(tx, householdId, tempoDay(payload.ts, timezone), payload.tempo_color);
    }
    return warnings;
  }

  // Index précédents de toutes les métriques en une lecture (verrouillés jusqu'au commit).
  const previous = new Map(
    (
      await tx
        .select()
        .from(meterState)
        .where(
          and(
            eq(meterState.householdId, householdId),
            inArray(
              meterState.metric,
              readings.map((r) => r.metric),
            ),
          ),
        )
        .for("update")
    ).map((p) => [p.metric, p]),
  );

  const intervals: (typeof energyInterval.$inferInsert)[] = [];
  const states: (typeof meterState.$inferInsert)[] = [];
  for (const reading of readings) {
    const prev = previous.get(reading.metric);
    const before: MeterReading | undefined = prev
      ? { metric: reading.metric, ts: prev.ts, value: prev.value }
      : undefined;
    const result = indexToIntervals(before, reading);
    warnings.push(...result.warnings);
    for (const i of result.intervals) {
      intervals.push({
        householdId,
        metric: i.metric,
        start: i.start,
        granularity: "hour",
        kwh: i.kwh,
        source: "ha",
      });
    }
    const rejected = result.warnings.some(
      (w) => w.code === "invalid_value" || w.code === "out_of_order",
    );
    if (!rejected) {
      states.push({ householdId, metric: reading.metric, ts: reading.ts, value: reading.value });
    }
  }

  if (intervals.length > 0) {
    await tx
      .insert(energyInterval)
      .values(intervals)
      .onConflictDoUpdate({
        target: intervalKey,
        // Une heure peut recevoir plusieurs parts (pushes décalés) : on cumule.
        // Une heure importée par CSV est remplacée : HA fait foi.
        set: {
          kwh: sql`case when ${energyInterval.source} = 'csv' then excluded.kwh else ${energyInterval.kwh} + excluded.kwh end`,
          source: sql`'ha'`,
        },
        // Une valeur corrigée à la main n'est plus touchée.
        setWhere: sql`${energyInterval.source} <> 'manual'`,
      });
  }
  if (states.length > 0) {
    await tx
      .insert(meterState)
      .values(states)
      .onConflictDoUpdate({
        target: [meterState.householdId, meterState.metric],
        set: { ts: sql`excluded.ts`, value: sql`excluded.value` },
      });
  }

  if (payload.tempo_color) {
    await upsertTempo(tx, householdId, tempoDay(payload.ts, timezone), payload.tempo_color);
  }

  return warnings;
}

/** Niveau de la batterie (T78) : le plus récent l'emporte, un envoi en retard ne recule pas. */
async function upsertBatteryState(
  tx: Tx,
  householdId: string,
  measuredAt: Date,
  socPercent: number,
) {
  await tx
    .insert(batteryState)
    .values({ householdId, measuredAt, socPercent })
    .onConflictDoUpdate({
      target: batteryState.householdId,
      set: { socPercent: sql`excluded.soc_percent`, measuredAt: sql`excluded.measured_at` },
      setWhere: sql`${batteryState.measuredAt} <= excluded.measured_at`,
    });
}

async function persistDaily(
  tx: Tx,
  householdId: string,
  timezone: string,
  payload: DailyPayload,
  slugs: string[],
): Promise<IngestWarning[]> {
  const { intervals, warnings } = dailyToIntervals(payload, slugs);
  const start = zonedInstant(payload.date, 0, timezone);

  if (intervals.length > 0) {
    await tx
      .insert(energyInterval)
      .values(
        intervals.map((i) => ({
          householdId,
          metric: i.metric,
          start,
          granularity: "day" as const,
          tariffSlot: i.slot ?? ("all" as const),
          kwh: i.kwh,
          source: "ha" as const,
        })),
      )
      // Idempotent : renvoyer la même date remplace les valeurs.
      .onConflictDoUpdate({
        target: intervalKey,
        set: { kwh: sql`excluded.kwh`, source: sql`'ha'` },
        setWhere: sql`${energyInterval.source} <> 'manual'`,
      });
  }

  if (payload.tempo_color) {
    await upsertTempo(tx, householdId, payload.date, payload.tempo_color);
  }

  return warnings;
}

async function upsertTempo(
  tx: Tx,
  householdId: string,
  date: string,
  color: "bleu" | "blanc" | "rouge",
) {
  await tx
    .insert(tempoOverride)
    .values({ householdId, date, color, source: "ha" })
    .onConflictDoUpdate({
      target: [tempoOverride.householdId, tempoOverride.date],
      set: { color },
      // Une correction manuelle prime sur la couleur poussée par HA.
      setWhere: sql`${tempoOverride.source} = 'ha'`,
    });
}

const LOG_RETENTION_DAYS = 30;

async function log<R extends IngestResponse>(
  householdId: string,
  rawBody: string,
  mode: "hourly" | "daily" | null,
  response: R,
  tx: Tx | typeof db = db,
): Promise<R> {
  await tx.insert(ingestLog).values({
    householdId,
    httpStatus: response.status,
    mode,
    payloadSize: Buffer.byteLength(rawBody),
    warnings: response.body.ok ? response.body.warnings : [],
    error: response.body.ok
      ? null
      : ("errors" in response.body
          ? JSON.stringify(response.body.errors)
          : response.body.error
        ).slice(0, 2000),
  });
  return response;
}

/** Journal des pushes conservé 30 jours (tâche quotidienne du planificateur). */
export async function pruneIngestLog(): Promise<number> {
  const rows = await db
    .delete(ingestLog)
    .where(lt(ingestLog.receivedAt, sql`now() - make_interval(days => ${LOG_RETENTION_DAYS})`))
    .returning({ id: ingestLog.id });
  return rows.length;
}
