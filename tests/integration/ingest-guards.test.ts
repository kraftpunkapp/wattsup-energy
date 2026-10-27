import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/ingest/route";
import { db } from "@/db";
import { batteryState, household, ingestLog } from "@/db/schema";
import { updateGranularity } from "@/server/household";
import { pruneIngestLog } from "@/server/ingest/persist";
import { getBatteryLevel, getLastPushAt } from "@/server/ingest/status";
import { createIngestToken } from "@/server/ingest/token";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

async function setup() {
  const ctx = await createTestHousehold("guards");
  const { token } = await createIngestToken(ctx);
  const push = (body: string, headers: Record<string, string> = {}, init: object = {}) =>
    POST(
      new Request("http://localhost/api/v1/ingest", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, ...headers },
        body,
        ...init,
      }),
    );
  return { ctx, push };
}

const hourly = JSON.stringify({ version: 1, ts: "2026-10-02T12:00:00Z" });
const daily = JSON.stringify({ version: 1, date: "2026-10-01" });

describe("granularité du foyer", () => {
  it("409 si un foyer horaire reçoit un payload quotidien, et inversement", async () => {
    const { ctx, push } = await setup();
    const r1 = await push(daily);
    expect(r1.status).toBe(409);
    expect(((await r1.json()) as { error: string }).error).toMatch(/mode horaire/);

    await updateGranularity(ctx, "daily");
    expect((await push(hourly)).status).toBe(409);
    expect((await push(daily)).status).toBe(200);
  });
});

describe("taille du corps", () => {
  it("413 au-delà de 64 Ko", async () => {
    const { push } = await setup();
    const big = JSON.stringify({ version: 1, ts: "2026-10-02T12:00:00Z", pad: "x".repeat(70_000) });
    expect((await push(big)).status).toBe(413);
  });

  it("413 sur un corps envoyé en flux sans content-length, lu sans aller au bout", async () => {
    const { push } = await setup();
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) controller.close();
        else controller.enqueue(new Uint8Array(16 * 1024).fill(32));
      },
    });
    const res = await push(endless as unknown as string, {}, { duplex: "half" });
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });

  it("413 sur un content-length annoncé trop grand", async () => {
    const { push } = await setup();
    expect((await push(hourly, { "content-length": String(1_000_000) })).status).toBe(413);
  });
});

describe("limitation de débit", () => {
  it("429 avec Retry-After au-delà de 120 requêtes par minute et par token", async () => {
    const { push } = await setup();
    for (let i = 0; i < 120; i++) expect((await push(hourly)).status).toBe(200);
    const refused = await push(hourly);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
  }, 30_000);

  it("un autre token n'est pas affecté", async () => {
    const { push } = await setup();
    expect((await push(hourly)).status).toBe(200);
  });
});

describe("journal et dernier push", () => {
  it("dernier push = dernière requête acceptée ; les erreurs ne comptent pas", async () => {
    const { ctx, push } = await setup();
    expect(await getLastPushAt(ctx)).toBeNull();
    await push(hourly);
    const first = await getLastPushAt(ctx);
    expect(first).toBeInstanceOf(Date);
    await push("{cassé");
    expect((await getLastPushAt(ctx))?.getTime()).toBe(first?.getTime());
  });

  it("niveau de la batterie : le dernier relevé envoyé, absent sinon", async () => {
    const { ctx, push } = await setup();
    await push(hourly);
    expect(await getBatteryLevel(ctx)).toBeNull();
    await push(
      JSON.stringify({ version: 1, ts: "2026-10-02T13:00:00Z", battery_soc_percent: 19.7 }),
    );
    expect(await getBatteryLevel(ctx)).toEqual({
      percent: 19.7,
      at: new Date("2026-10-02T13:00:00Z"),
    });
  });

  it("purge quotidienne : les entrées de plus de 30 jours sont supprimées", async () => {
    const { ctx, push } = await setup();
    await db.insert(ingestLog).values({
      householdId: ctx.householdId,
      httpStatus: 200,
      payloadSize: 1,
      receivedAt: new Date(Date.now() - 31 * 86_400_000),
    });
    await push(hourly);
    expect(await pruneIngestLog()).toBeGreaterThanOrEqual(1);
    const rows = await db
      .select()
      .from(ingestLog)
      .where(eq(ingestLog.householdId, ctx.householdId));
    expect(rows).toHaveLength(1);
  });
});

describeTenantIsolation("dernier push", {
  setup: async (b) => {
    await db
      .insert(ingestLog)
      .values({ householdId: b.householdId, httpStatus: 200, payloadSize: 1 });
    return b.householdId;
  },
  attempt: (a) => getLastPushAt(a),
  expect: "empty",
});

describeTenantIsolation("niveau de la batterie", {
  setup: async (b) => {
    await db
      .insert(batteryState)
      .values({ householdId: b.householdId, socPercent: 50, measuredAt: new Date() });
    return b.householdId;
  },
  attempt: (a) => getBatteryLevel(a),
  expect: "empty",
});

describeTenantIsolation("changement de granularité", {
  setup: async (b) => b.householdId,
  attempt: async (a) => {
    await updateGranularity(a, "daily");
    return [];
  },
  untouched: async (_b, id) => {
    const [row] = await db.select().from(household).where(eq(household.id, id));
    expect(row?.granularity).toBe("hourly");
  },
});
