import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { household } from "@/db/schema";
import { householdContextFor } from "@/server/context";
import { createContract } from "@/server/contracts";
import { overviewBlocksFor, overviewHidden, setOverviewBlockHidden } from "@/server/overview-prefs";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

describe("vue d'ensemble personnalisable", () => {
  it("masquer puis réafficher un bloc ; les autres réglages restent", async () => {
    const ctx = await createTestHousehold("blocs");
    expect(await setOverviewBlockHidden(ctx, "baseload", true)).toEqual(["baseload"]);
    expect(await setOverviewBlockHidden(ctx, "peak", true)).toEqual(["baseload", "peak"]);
    const fresh = await householdContextFor(ctx.userId);
    expect(overviewHidden(fresh)).toEqual(["baseload", "peak"]);
    expect(fresh.settings.pelletBagKg).toBe(15);
    expect(await setOverviewBlockHidden(ctx, "baseload", false)).toEqual(["peak"]);
  });

  it("blocs proposés selon le contrat en cours", async () => {
    const ctx = await createTestHousehold("blocs");
    expect(await overviewBlocksFor(ctx)).toEqual(["advice", "baseload"]);
    await createContract(ctx, {
      name: "Heures creuses",
      contract: {
        kind: "hphc",
        subscriptionEurYear: 236,
        prices: { hp: 0.27, hc: 0.2 },
        hcRanges: [{ from: "22:00", to: "06:00" }],
      },
      subscription: { startDate: "2024-01-01", endDate: null },
    });
    expect(await overviewBlocksFor(ctx)).toEqual(["advice", "peak", "baseload"]);
  });
});

describeTenantIsolation("vue d'ensemble personnalisable", {
  setup: async (b) => b,
  attempt: async (a) => {
    await setOverviewBlockHidden(a, "advice", true);
    return null;
  },
  expect: "empty",
  untouched: async (b) => {
    const [row] = await db
      .select({ settings: household.settings })
      .from(household)
      .where(eq(household.id, b.householdId));
    expect(row?.settings.overview).toBeUndefined();
  },
});
