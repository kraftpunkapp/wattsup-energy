import { beforeAll, describe, expect, it } from "vitest";
import { householdContextFor, type HouseholdContext } from "@/server/context";
import { addQuickConsumption } from "@/server/fuel";
import { getHeating } from "@/server/queries/heating";
import { seedDemo } from "../../scripts/seed/seed";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

const now = new Date("2026-02-01T08:00:00Z");
let ctx: HouseholdContext;

describe("vue Chauffage sur le foyer de démo", () => {
  beforeAll(async () => {
    const r = await seedDemo({
      email: "heating-test@wattsup.test",
      password: "motdepasse-de-test",
      days: 500,
      now,
    });
    ctx = await householdContextFor(r.userId);
  }, 120_000);

  it("saison en cours : coût = électricité + granulés + bois, mois détaillés, N-1 disponible", async () => {
    const h = await getHeating(ctx, undefined, now);
    expect(h.season.label).toBe("2025–2026");
    expect(h).toMatchObject({ to: "2026-02-02", inProgress: true, noLocation: false });
    expect(h.current.fuels.pellet?.method).toBe("events");
    expect(h.current.dju).toBeGreaterThan(500);
    const c = h.current.cost;
    expect(c.totalCents).toBe(
      (c.byFuel.electric?.cents ?? 0) + (c.byFuel.pellet?.cents ?? 0) + (c.byFuel.wood?.cents ?? 0),
    );
    const monthly = h.months.reduce((a, m) => a + m.electricCents + m.pelletCents + m.woodCents, 0);
    expect(Math.abs(monthly - c.totalCents)).toBeLessThanOrEqual(h.months.length * 2);
    expect(h.months.map((m) => m.key)).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(h.previous?.fuels.pellet?.qty).toBeGreaterThan(0);
    expect(h.nav).toEqual({ prev: 2024, next: null });
  });

  it("saison entière : mois à venir vides, même mois de la saison précédente, mois en cours partiel", async () => {
    const h = await getHeating(ctx, undefined, now);
    const keys = h.seasonMonths.map((m) => m.key);
    expect(keys.slice(0, 5)).toEqual(["2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(keys.length).toBeGreaterThan(5);
    expect(h.seasonMonths.filter((m) => m.elapsed).map((m) => m.key)).toEqual(keys.slice(0, 5));
    expect(h.seasonMonths.filter((m) => !m.elapsed).every((m) => m.cents === null)).toBe(true);
    const jan = h.seasonMonths.find((m) => m.key === "2026-01");
    expect(jan?.cents).toBeGreaterThan(0);
    expect(jan?.previousCents).toBeGreaterThan(0);
    expect(jan?.dju).toBeGreaterThan(0);
    expect(h.partialMonth).toMatchObject({ key: "2026-02", day: 1 });
  });

  it("saison passée demandée par l'URL, sinon la saison en cours", async () => {
    expect((await getHeating(ctx, "2024", now)).season.label).toBe("2024–2025");
    expect((await getHeating(ctx, "2031", now)).season.label).toBe("2025–2026");
    expect((await getHeating(ctx, "abc", now)).season.label).toBe("2025–2026");
  });

  it("granulés seuls : aucune trace de bois ni d'électricité de chauffage", async () => {
    const pelletOnly = {
      ...ctx,
      profile: { ...ctx.profile, wood: false, electricHeating: false },
    };
    const h = await getHeating(pelletOnly, undefined, now);
    expect(h.modules).toEqual({ pellet: true, wood: false, electric: false });
    expect(h.current.fuels.wood).toBeUndefined();
    expect(h.current.cost.byFuel.wood).toBeUndefined();
    expect(h.current.cost.byFuel.electric).toBeUndefined();
    expect(h.months.every((m) => m.woodCents === 0 && m.electricCents === 0)).toBe(true);
  });
});

describeTenantIsolation("vue Chauffage", {
  setup: async (b) => {
    await addQuickConsumption(b, "pellet", new Date("2026-01-10T19:00:00Z"));
    return null;
  },
  attempt: async (a) => {
    const h = await getHeating(a, undefined, now);
    return (h.current.fuels.pellet?.qty ?? 0) > 0 ? [h] : [];
  },
  expect: "empty",
});

describe("foyer sans combustible ni commune", () => {
  it("vue calculée sans erreur, sans météo", async () => {
    const fresh = await createTestHousehold();
    const h = await getHeating(fresh, undefined, now);
    expect(h).toMatchObject({ noLocation: true, previous: null });
    expect(h.current.cost.totalCents).toBe(0);
  });
});
