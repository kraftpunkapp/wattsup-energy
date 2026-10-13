import { and, eq, gte, lt, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { energyInterval } from "@/db/schema";
import { householdContextFor } from "@/server/context";
import { createMarker } from "@/server/markers";
import { getOverview } from "@/server/queries/overview";
import { zonedInstant } from "@/lib/time";
import { seedDemo } from "../../scripts/seed/seed";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

const now = new Date("2026-10-03T08:00:00Z");
const TZ = "Europe/Paris";

type Demo = Awaited<ReturnType<typeof seedDemo>> & {
  ctx: Awaited<ReturnType<typeof householdContextFor>>;
};
let seeded: Demo;
const demo = async () => seeded;

const kwhOf = async (householdId: string, metric: string, from: string, to: string) => {
  const [row] = await db
    .select({ kwh: sql<number>`sum(${energyInterval.kwh})`.mapWith(Number) })
    .from(energyInterval)
    .where(
      and(
        eq(energyInterval.householdId, householdId),
        eq(energyInterval.metric, metric),
        gte(energyInterval.start, zonedInstant(from, 0, TZ)),
        lt(energyInterval.start, zonedInstant(to, 0, TZ)),
      ),
    );
  return row?.kwh ?? 0;
};

describe("vue d'ensemble sur le foyer de démo", () => {
  // 430 jours horaires : septembre 2025 sert de comparaison N-1.
  beforeAll(async () => {
    const r = await seedDemo({
      email: "overview-test@wattsup.test",
      password: "motdepasse-de-test",
      days: 430,
      now,
    });
    seeded = { ...r, ctx: await householdContextFor(r.userId) };
  }, 120_000);

  it("mois : budget = coût du mois des barres ; bilan et postes issus des données", async () => {
    const { ctx, householdId } = await demo();
    const o = await getOverview(ctx, "2026-09", now);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.period).toMatchObject({ from: "2026-09-01", to: "2026-10-01" });
    expect(o.nav).toEqual({ prev: "2026-08", next: "2026-10" });

    const sept = o.months.find((m) => m.key === "2026-09");
    expect(o.budget.totalCents).toBe((sept?.energyCents ?? 0) + (sept?.subscriptionCents ?? 0));
    expect(o.budget.totalCents).toBeGreaterThan(0);
    // Septembre 2025 est dans les données de démo : la comparaison N-1 est disponible.
    expect(o.budget.previousCents).toBeGreaterThan(0);

    const grid = await kwhOf(householdId, "grid_import", "2026-09-01", "2026-10-01");
    expect(sept?.kwh).toBeCloseTo(grid, 3);
    // Tableau mensuel : HP + HC = soutiré (contrat de démo en heures creuses) ; production.
    expect((sept?.hpKwh ?? 0) + (sept?.hcKwh ?? 0)).toBeCloseTo(grid, 3);
    const solarSept = await kwhOf(householdId, "solar_production", "2026-09-01", "2026-10-01");
    expect(sept?.solarKwh).toBeCloseTo(solarSept, 3);
    expect(sept?.solarSavingCents).toBeGreaterThan(0);
    // N-1 : septembre 2025 entier, chiffré avec le contrat de l'époque.
    const gridSept2025 = await kwhOf(householdId, "grid_import", "2025-09-01", "2025-10-01");
    expect(sept?.previous?.kwh).toBeCloseTo(gridSept2025, 3);
    expect(sept?.previous?.energyCents).toBeGreaterThan(0);
    expect(o.budget.previousCents).toBe(
      (sept?.previous?.energyCents ?? 0) + (sept?.previous?.subscriptionCents ?? 0),
    );
    expect(o.batteryGaps).toEqual([]);
    // Contrat de démo en heures creuses : la part HP / HC couvre tout le soutirage.
    expect(o.peak?.hp.kwh).toBeGreaterThan(0);
    expect(o.peak?.hc.kwh).toBeGreaterThan(0);
    expect((o.peak?.hp.kwh ?? 0) + (o.peak?.hc.kwh ?? 0) + (o.peak?.otherKwh ?? 0)).toBeCloseTo(
      grid,
      3,
    );
    expect(o.balance.gridImport).toBeCloseTo(grid, 3);
    expect(o.balance.consumption).toBeCloseTo(
      o.balance.origin.grid + o.balance.origin.solar + o.balance.origin.battery,
      6,
    );
    const water = await kwhOf(householdId, "category:eau-chaude", "2026-09-01", "2026-10-01");
    expect(o.categories.find((c) => c.name === "Eau chaude")?.kwh).toBeCloseTo(water, 3);

    // Vue mois : un jour par barre ; leur somme fait le mois, à l'arrondi près.
    const days = o.days?.list ?? [];
    expect(days).toHaveLength(30);
    expect(days.reduce((a, d) => a + d.kwh, 0)).toBeCloseTo(grid, 3);
    const daysCents = days.reduce((a, d) => a + d.energyCents + d.subscriptionCents, 0);
    expect(Math.abs((o.budget.totalCents ?? 0) - daysCents)).toBeLessThanOrEqual(60);
    expect(days.every((d) => d.hasData && d.previous !== null)).toBe(true);
    // Tendance : moyenne sur 7 jours, centrée, un point par jour.
    const trend = o.days?.trend.kwh ?? [];
    expect(trend).toHaveLength(30);
    const window = days.slice(7, 14).reduce((a, d) => a + d.kwh, 0) / 7;
    expect(trend[10]).toBeCloseTo(window, 6);
    // Mois en cours : jusqu'à aujourd'hui, sans point de tendance pour le jour entamé.
    const current = await getOverview(ctx, "2026-10", now);
    if (current.status !== "ok") throw new Error(current.status);
    expect(current.days?.list.map((d) => d.key)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(current.days?.trend.kwh.at(-1)).toBeNull();

    expect(o.solar?.points).toHaveLength(30);
    // N-1 : production de septembre 2025, jour par jour.
    const solar2025 = await kwhOf(householdId, "solar_production", "2025-09-01", "2025-10-01");
    const previous = (o.solar?.points ?? []).reduce((a, p) => a + (p.previousKwh ?? 0), 0);
    expect(previous).toBeCloseTo(solar2025, 3);
    expect(o.solar?.kwh).toBeGreaterThan(0);
    expect(o.solar?.yield).toBeGreaterThan(0);
    expect(o.solar?.previousYield).toBeGreaterThan(0);
  });

  it("année : budget = somme des mois (à l'arrondi près) ; mois futurs exclus", async () => {
    const { ctx } = await demo();
    const o = await getOverview(ctx, "2026", now);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.months.map((m) => m.key).at(-1)).toBe("2026-10");
    const sum = o.months.reduce((a, m) => a + m.energyCents + m.subscriptionCents, 0);
    expect(Math.abs((o.budget.totalCents ?? 0) - sum)).toBeLessThanOrEqual(o.months.length);
    expect(o.solar?.points).toHaveLength(10);
    expect(o.days).toBeNull();
  });

  it("projection : année en cours seulement, au moins la dépense déjà connue", async () => {
    const { ctx } = await demo();
    const o = await getOverview(ctx, "2026", now);
    if (o.status !== "ok") throw new Error(o.status);
    const spent = o.months.reduce((a, m) => a + m.energyCents + m.subscriptionCents, 0);
    expect(o.projection?.totalCents).toBeGreaterThan(spent);
    // 2025 n'est pas complète dans les données de démo : pas de total N-1.
    expect(o.projection?.previousTotalCents).toBeNull();
    const past = await getOverview(ctx, "2025", now);
    expect(past.status === "ok" && past.projection).toBeNull();
  });

  it("sans contrat souscrit ni actuel, l'électricité n'est pas chiffrée", async () => {
    const ctx = await createTestHousehold();
    await db.insert(energyInterval).values({
      householdId: ctx.householdId,
      metric: "grid_import",
      start: new Date("2026-10-01T10:00:00Z"),
      granularity: "hour",
      kwh: 1,
      source: "ha",
    });
    const o = await getOverview(ctx, undefined, now);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.budget.totalCents).toBeNull();
    expect(o.balance.gridImport).toBe(1);
  });

  it("batterie : signale les mois où la décharge arrive sans la charge", async () => {
    const base = await createTestHousehold();
    const ctx = { ...base, profile: { ...base.profile, battery: true } };
    const row = (metric: string, start: string, kwh: number) => ({
      householdId: ctx.householdId,
      metric,
      start: new Date(start),
      granularity: "hour" as const,
      kwh,
      source: "ha" as const,
    });
    await db
      .insert(energyInterval)
      .values([
        row("grid_import", "2026-02-10T10:00:00Z", 1),
        row("battery_discharge", "2026-02-10T19:00:00Z", 3),
        row("battery_charge", "2026-03-10T12:00:00Z", 4),
        row("battery_discharge", "2026-03-10T19:00:00Z", 3),
      ]);
    const o = await getOverview(ctx, "2026", now);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.batteryGaps).toEqual([{ missing: "charge", months: ["2026-02"] }]);
  });

  it("repères : ceux de l'année seulement (les automatiques sont testés dans le domaine)", async () => {
    const base = await createTestHousehold();
    await db.insert(energyInterval).values({
      householdId: base.householdId,
      metric: "grid_import",
      start: new Date("2026-03-10T10:00:00Z"),
      granularity: "hour",
      kwh: 1,
      source: "ha",
    });
    await createMarker(base, {
      kind: "absence",
      text: "Vacances",
      startDate: "2026-07-28",
      endDate: "2026-08-15",
    });
    await createMarker(base, {
      kind: "other",
      text: "Hors année",
      startDate: "2025-05-01",
      endDate: null,
    });
    const o = await getOverview(base, "2026", now);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.markers.map((m) => m.text)).toEqual(["Vacances"]);
  });

  it("talon : médiane des minima de nuit, consommation = import − charge de la batterie", async () => {
    const ctx = await createTestHousehold("talon");
    const rows: (typeof energyInterval.$inferInsert)[] = [];
    for (let d = 1; d <= 10; d++) {
      const date = `2026-09-${String(d).padStart(2, "0")}`;
      for (let hour = 0; hour < 24; hour++) {
        const start = zonedInstant(date, hour, TZ);
        // Nuit : 0,3 kWh importés dont 0,1 part dans la batterie à 3 h, soit 0,2 consommés.
        const night = hour === 3;
        const base = {
          householdId: ctx.householdId,
          start,
          granularity: "hour" as const,
          source: "ha" as const,
        };
        rows.push({ ...base, metric: "grid_import", kwh: night ? 0.3 : 0.6 });
        rows.push({ ...base, metric: "battery_charge", kwh: night ? 0.1 : 0 });
      }
    }
    await db.insert(energyInterval).values(rows);
    const o = await getOverview(ctx, "2026-09", now);
    if (o.status !== "ok") throw new Error(o.status);
    expect(o.baseload?.watts).toBe(200);
    expect(o.baseload?.previousWatts).toBeNull();
    expect(o.baseload?.months).toHaveLength(12);
    expect(o.baseload?.months.at(-1)).toEqual({ month: "2026-09", watts: 200 });
    // Quotidien : pas de talon.
    const daily = await getOverview({ ...ctx, granularity: "daily" }, "2026-09", now);
    expect(daily.status === "ok" && daily.baseload).toBeNull();
  });

  it("aucune donnée : no-data", async () => {
    const ctx = await createTestHousehold();
    expect(await getOverview(ctx, undefined, now)).toEqual({ status: "no-data" });
  });
});

describeTenantIsolation("vue d'ensemble", {
  setup: async (b) => {
    await db.insert(energyInterval).values({
      householdId: b.householdId,
      metric: "grid_import",
      start: new Date("2026-10-01T10:00:00Z"),
      granularity: "hour",
      kwh: 5,
      source: "ha",
    });
    return null;
  },
  attempt: async (a) => {
    const o = await getOverview(a, undefined, now);
    return o.status === "no-data" ? [] : [o];
  },
  expect: "empty",
});
