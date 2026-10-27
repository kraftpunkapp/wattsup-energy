import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/ingest/route";
import { db } from "@/db";
import { batteryLevel, energyInterval } from "@/db/schema";
import type { HouseholdContext } from "@/server/context";
import {
  DataError,
  dayBatteryLevels,
  dayValues,
  deleteRange,
  deleteValue,
  hasBatteryLevels,
  rangeSummary,
  setValue,
  storedMetrics,
  suspectValues,
  type ValueKey,
} from "@/server/energy-data";
import { createIngestToken } from "@/server/ingest/token";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

const hour = (ctx: HouseholdContext, metric: string, start: string, kwh: number) => ({
  householdId: ctx.householdId,
  metric,
  start: new Date(start),
  granularity: "hour" as const,
  kwh,
  source: "ha" as const,
});

const key = (metric: string, start: string): ValueKey => ({
  metric,
  start: new Date(start),
  granularity: "hour",
  tariffSlot: "all",
});

async function seeded() {
  const ctx = await createTestHousehold("donnees");
  await db.insert(energyInterval).values([
    hour(ctx, "grid_import", "2026-03-09T23:00:00Z", 0.4), // 10 mars, 0 h à Paris
    hour(ctx, "grid_import", "2026-03-10T08:00:00Z", 0.6),
    hour(ctx, "battery_charge", "2026-03-10T09:00:00Z", 5423), // saut aberrant
    hour(ctx, "grid_import", "2026-03-11T08:00:00Z", 0.5),
  ]);
  return ctx;
}

describe("onglet Données", () => {
  it("compteurs présents, valeurs suspectes, valeurs d'un jour local", async () => {
    const ctx = await seeded();
    expect(await storedMetrics(ctx)).toEqual(["battery_charge", "grid_import"]);
    expect((await suspectValues(ctx)).map((v) => [v.metric, v.kwh])).toEqual([
      ["battery_charge", 5423],
    ]);
    expect((await dayValues(ctx, "grid_import", "2026-03-10")).map((v) => v.kwh)).toEqual([
      0.4, 0.6,
    ]);
  });

  it("niveaux de la batterie : relevés d'un jour local, dans l'ordre", async () => {
    const ctx = await createTestHousehold("donnees-batterie");
    expect(await hasBatteryLevels(ctx)).toBe(false);
    await db.insert(batteryLevel).values(
      [
        ["2026-03-10T09:00:00Z", 64],
        ["2026-03-09T23:00:00Z", 30], // 10 mars, 0 h à Paris
        ["2026-03-09T22:00:00Z", 31], // 9 mars, 23 h
        ["2026-03-10T23:00:00Z", 70], // 11 mars, 0 h
      ].map(([at, percent]) => ({
        householdId: ctx.householdId,
        measuredAt: new Date(at as string),
        socPercent: percent as number,
      })),
    );
    expect(await hasBatteryLevels(ctx)).toBe(true);
    expect((await dayBatteryLevels(ctx, "2026-03-10")).map((l) => l.percent)).toEqual([30, 64]);
  });

  it("corriger : source « manuel », puis un envoi HA ne l'écrase plus", async () => {
    const ctx = await seeded();
    const fixed = await setValue(ctx, key("battery_charge", "2026-03-10T09:00:00Z"), 1.2);
    expect(fixed).toMatchObject({ kwh: 1.2, source: "manual" });
    expect(await suspectValues(ctx)).toEqual([]);
    await expect(setValue(ctx, key("battery_charge", "2026-03-10T09:00:00Z"), 99)).rejects.toThrow(
      DataError,
    );

    // L'heure corrigée reçoit une part d'un envoi horaire : elle reste telle quelle.
    await setValue(ctx, key("grid_import", "2026-03-10T08:00:00Z"), 0.3);
    const { token } = await createIngestToken(ctx);
    const push = (ts: string, value: number) =>
      POST(
        new Request("http://localhost/api/v1/ingest", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({ version: 1, ts, energy: { grid_import_kwh: value } }),
        }),
      );
    await push("2026-03-10T08:00:00Z", 100);
    await push("2026-03-10T09:00:00Z", 100.5); // l'heure de 8 h reçoit 0,5 kWh
    const [row] = await db
      .select()
      .from(energyInterval)
      .where(
        and(
          eq(energyInterval.householdId, ctx.householdId),
          eq(energyInterval.metric, "grid_import"),
          eq(energyInterval.start, new Date("2026-03-10T08:00:00Z")),
        ),
      );
    expect(row).toMatchObject({ kwh: 0.3, source: "manual" });
  });

  it("supprimer une valeur ; aperçu puis suppression d'une plage (un compteur ou tous)", async () => {
    const ctx = await seeded();
    expect(await deleteValue(ctx, key("grid_import", "2026-03-11T08:00:00Z"))).toBe(true);
    expect(
      await rangeSummary(ctx, { metric: "grid_import", from: "2026-03-10", to: "2026-03-10" }),
    ).toEqual({
      count: 2,
      kwh: 1,
    });
    expect(
      await rangeSummary(ctx, { metric: null, from: "2026-03-10", to: "2026-03-10" }),
    ).toMatchObject({
      count: 3,
    });
    expect(
      await deleteRange(ctx, { metric: "grid_import", from: "2026-03-10", to: "2026-03-10" }),
    ).toBe(2);
    expect(await storedMetrics(ctx)).toEqual(["battery_charge"]);
    await expect(
      rangeSummary(ctx, { metric: null, from: "2026-03-11", to: "2026-03-10" }),
    ).rejects.toThrow(DataError);
  });
});

const ownedByB = async (b: HouseholdContext) => {
  await db.insert(energyInterval).values(hour(b, "grid_import", "2026-03-10T08:00:00Z", 0.6));
  return key("grid_import", "2026-03-10T08:00:00Z");
};
const untouched = async (b: HouseholdContext) => {
  expect((await dayValues(b, "grid_import", "2026-03-10")).map((v) => [v.kwh, v.source])).toEqual([
    [0.6, "ha"],
  ]);
};
const range = { metric: null, from: "2026-03-01", to: "2026-03-31" };

describeTenantIsolation("données : compteurs et valeurs d'un jour", {
  setup: ownedByB,
  attempt: async (a) => [
    ...(await storedMetrics(a)),
    ...(await dayValues(a, "grid_import", "2026-03-10")),
  ],
  expect: "empty",
});
describeTenantIsolation("données : niveaux de la batterie", {
  setup: async (b) => {
    await db.insert(batteryLevel).values({
      householdId: b.householdId,
      measuredAt: new Date("2026-03-10T09:00:00Z"),
      socPercent: 64,
    });
    return b.householdId;
  },
  attempt: async (a) => [
    ...((await hasBatteryLevels(a)) ? ["fuite"] : []),
    ...(await dayBatteryLevels(a, "2026-03-10")),
  ],
  expect: "empty",
});
describeTenantIsolation("données : correction d'une valeur", {
  setup: ownedByB,
  attempt: (a, k) => setValue(a, k, 1),
  expect: "empty",
  untouched,
});
describeTenantIsolation("données : suppression d'une valeur", {
  setup: ownedByB,
  attempt: async (a, k) => ((await deleteValue(a, k)) ? ["supprimée"] : []),
  expect: "empty",
  untouched,
});
describeTenantIsolation("données : aperçu et suppression d'une plage", {
  setup: ownedByB,
  attempt: async (a) => {
    const before = await rangeSummary(a, range);
    const deleted = await deleteRange(a, range);
    return before.count + deleted > 0 ? ["fuite"] : [];
  },
  expect: "empty",
  untouched,
});
