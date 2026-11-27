import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { energyInterval } from "@/db/schema";
import { getAdvice } from "@/server/advice";
import { addPricePeriod, createContract, listContracts } from "@/server/contracts";
import { householdContextFor, type HouseholdContext } from "@/server/context";
import { updateProfile } from "@/server/profile";
import { addDays, zonedInstant } from "@/lib/time";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

const NOW = new Date("2026-10-07T10:00:00Z");

/** Foyer solaire en HP/HC : 1,5 kWh exportés chaque jour de 12 h à 14 h. */
async function solarHphc(): Promise<HouseholdContext> {
  const base = await createTestHousehold("conseils");
  await updateProfile(base, { ...base.profile, solar: true });
  const ctx = await householdContextFor(base.userId);
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
  const rows: (typeof energyInterval.$inferInsert)[] = [];
  for (let d = 1; d <= 20; d++) {
    const date = addDays("2026-10-07", -d);
    for (const hour of [12, 13]) {
      rows.push({
        householdId: ctx.householdId,
        metric: "grid_export",
        start: zonedInstant(date, hour, "Europe/Paris"),
        granularity: "hour",
        kwh: 1.5,
        source: "ha",
      });
    }
  }
  await db.insert(energyInterval).values(rows);
  return ctx;
}

describe("quand consommer", () => {
  it("surplus de midi et heures creuses du contrat", async () => {
    const ctx = await solarHphc();
    const advice = await getAdvice(ctx, NOW);
    expect(advice.map((a) => a.title)).toEqual([
      "Entre 12 h et 14 h : votre surplus solaire",
      "Heures creuses : 22 h – 6 h",
    ]);
  });

  it("une grille à venir ne s'applique pas avant sa date", async () => {
    const ctx = await solarHphc();
    const [contract] = await listContracts(ctx);
    await addPricePeriod(ctx, contract?.id ?? "", {
      validFrom: "2026-12-01",
      contract: {
        kind: "hphc",
        subscriptionEurYear: 236,
        prices: { hp: 0.27, hc: 0.2068 },
        hcRanges: [{ from: "23:00", to: "07:00" }],
      },
    });
    const titles = async (now: Date) => (await getAdvice(ctx, now)).map((a) => a.title);
    expect(await titles(NOW)).toContain("Heures creuses : 22 h – 6 h");
    expect(await titles(new Date("2026-12-02T10:00:00Z"))).toContain(
      "Heures creuses : 23 h – 7 h",
    );
  });
});

describeTenantIsolation("quand consommer", {
  setup: solarHphc,
  attempt: (a) => getAdvice({ ...a, profile: { ...a.profile, solar: true } }, NOW),
  expect: "empty",
});
