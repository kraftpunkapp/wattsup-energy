import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { household } from "@/db/schema";
import { householdContextFor } from "@/server/context";
import { setWoodInvitationHidden, woodInvitationHidden } from "@/server/heating-prefs";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

describe("invitation « Suivre le bois »", () => {
  it("masquée puis réaffichée ; les autres réglages restent", async () => {
    const ctx = await createTestHousehold("bois");
    expect(woodInvitationHidden(ctx)).toBe(false);
    await setWoodInvitationHidden(ctx, true);
    const fresh = await householdContextFor(ctx.userId);
    expect(woodInvitationHidden(fresh)).toBe(true);
    expect(fresh.settings.pelletBagKg).toBe(15);
    await setWoodInvitationHidden(ctx, false);
    expect(woodInvitationHidden(await householdContextFor(ctx.userId))).toBe(false);
  });
});

describeTenantIsolation("invitation « Suivre le bois »", {
  setup: async (b) => b,
  attempt: async (a) => {
    await setWoodInvitationHidden(a, true);
    return null;
  },
  expect: "empty",
  untouched: async (b) => {
    const [row] = await db
      .select({ settings: household.settings })
      .from(household)
      .where(eq(household.id, b.householdId));
    expect(row?.settings.woodInvitationHidden).toBeUndefined();
  },
});
