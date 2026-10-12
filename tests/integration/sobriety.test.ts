import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { energyInterval, sobrietyDay } from "@/db/schema";
import type { HouseholdContext } from "@/server/context";
import { createContract } from "@/server/contracts";
import { setManualSobriety, sobrietyCalendarView, sobrietyDaysFor } from "@/server/calendars";
import { getContractComparison } from "@/server/queries/contracts";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

// Jours de sobriété Zen Flex (T57) : calendrier global, corrections du foyer, et prise en
// compte par les calculs de coût.

const now = new Date("2026-01-20T10:00:00Z");
const DAY = "2026-01-15";

async function withGlobalDay(date: string) {
  await db.insert(sobrietyDay).values({ date }).onConflictDoNothing();
}

describe("calendrier et corrections", () => {
  it("le calendrier global, corrigé par le foyer dans les deux sens", async () => {
    const ctx = await createTestHousehold("sobriety");
    await withGlobalDay(DAY);
    expect([...(await sobrietyDaysFor(ctx.householdId, "2026-01-01", "2026-01-31"))]).toContain(
      DAY,
    );

    await setManualSobriety(ctx.householdId, DAY, false);
    await setManualSobriety(ctx.householdId, "2026-01-16", true);
    const days = await sobrietyDaysFor(ctx.householdId, "2026-01-01", "2026-01-31");
    expect(days.has(DAY)).toBe(false);
    expect(days.has("2026-01-16")).toBe(true);
    expect((await sobrietyCalendarView(ctx.householdId, DAY, DAY)).get(DAY)).toEqual({
      sobriety: false,
      source: "manual",
    });

    await setManualSobriety(ctx.householdId, DAY, null);
    expect((await sobrietyDaysFor(ctx.householdId, DAY, DAY)).has(DAY)).toBe(true);
  });

  it("la comparaison facture les jours de sobriété au prix de leurs règles", async () => {
    const ctx = await createTestHousehold("sobriety-cost");
    // 1 kWh à midi chaque jour du 10 au 19 janvier (heure pleine pour les deux règles).
    await db.insert(energyInterval).values(
      Array.from({ length: 10 }, (_, i) => ({
        householdId: ctx.householdId,
        metric: "grid_import",
        start: new Date(Date.UTC(2026, 0, 10 + i, 11)),
        granularity: "hour" as const,
        kwh: 1,
        source: "ha" as const,
      })),
    );
    const ALL = [{ from: "00:00", to: "24:00" }];
    const WEEK = [1, 2, 3, 4, 5, 6, 7];
    await createContract(ctx, {
      name: "Zen Flex",
      contract: {
        kind: "custom",
        subscriptionEurYear: 0,
        rules: [
          { label: "Sobriété", days: WEEK, ranges: ALL, price: 1, onlySobrietyDays: true },
          { label: "Normal", days: WEEK, ranges: ALL, price: 0.1 },
        ],
      },
      subscription: null,
    });
    const cost = async () => {
      const r = await getContractComparison(ctx, now);
      if (r.status !== "ok") throw new Error(r.status);
      return r.rows[0]?.totalCents;
    };
    await setManualSobriety(ctx.householdId, DAY, false);
    expect(await cost()).toBe(100); // 10 × 0,10 €
    await setManualSobriety(ctx.householdId, DAY, true);
    expect(await cost()).toBe(190); // 9 × 0,10 € + 1 × 1 €
  });
});

describeTenantIsolation<HouseholdContext>("corrections des jours de sobriété", {
  setup: async (b) => {
    await setManualSobriety(b.householdId, "2026-02-02", true);
    return b;
  },
  attempt: async (a) => [
    ...(await sobrietyCalendarView(a.householdId, "2026-02-02", "2026-02-02")),
  ],
  expect: "empty",
});
