import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { household } from "@/db/schema";
import { householdContextFor, type HouseholdContext } from "@/server/context";
import { createContract } from "@/server/contracts";
import { hideOffPeakNotice, showOffPeakNotice } from "@/server/off-peak-notice";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

const NOW = new Date("2026-11-27T10:00:00Z");

async function withHphc(ctx: HouseholdContext) {
  await createContract(ctx, {
    name: "Heures creuses",
    contract: {
      kind: "hphc",
      subscriptionEurYear: 236,
      prices: { hp: 0.27, hc: 0.2068 },
      hcRanges: [{ from: "22:00", to: "06:00" }],
    },
    subscription: { startDate: "2025-01-01", endDate: null },
  });
  return ctx;
}

describe("encart « Vérifiez vos horaires »", () => {
  it("affiché avec un contrat HP/HC en cours, puis masqué pour de bon", async () => {
    const ctx = await createTestHousehold("horaires");
    expect(await showOffPeakNotice(ctx, NOW)).toBe(false);
    await withHphc(ctx);
    expect(await showOffPeakNotice(ctx, NOW)).toBe(true);
    await hideOffPeakNotice(ctx);
    const fresh = await householdContextFor(ctx.userId);
    expect(await showOffPeakNotice(fresh, NOW)).toBe(false);
    expect(fresh.settings.pelletBagKg).toBe(15);
  });
});

describeTenantIsolation("encart heures creuses", {
  setup: withHphc,
  attempt: async (a) => {
    await hideOffPeakNotice(a);
    return null;
  },
  expect: "empty",
  untouched: async (b) => {
    const [row] = await db
      .select({ settings: household.settings })
      .from(household)
      .where(eq(household.id, b.householdId));
    expect(row?.settings.offPeakNoticeHidden).toBeUndefined();
  },
});
