import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import {
  batteryState,
  energyInterval,
  household,
  householdForecast,
  pushSubscription,
  weatherForecastHourly,
} from "@/db/schema";
import { cellOf } from "@/domain/weather";
import { householdContextFor, type HouseholdContext } from "@/server/context";
import { saveEquipment } from "@/server/equipment";
import { createContract } from "@/server/contracts";
import {
  getDayAheadForecast,
  getForecastAccuracy,
  getForecastPlan,
  getPricedForecast,
  getSolarForecast,
  snapshotForecast,
} from "@/server/forecast";
import { saveAppliance } from "@/server/appliances";
import { notifyTomorrow } from "@/server/forecast-notify";
import { updateTomorrowNotice } from "@/server/settings";
import { setLocation } from "@/server/location";
import { updateProfile } from "@/server/profile";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

// Prévisions « Demain » (T68, SPEC §7.14) : production solaire prévue d'après le rendement
// appris sur l'historique du foyer et la météo horaire de sa commune.

const now = new Date("2026-11-21T12:00:00Z");
let n = 0;

type Location = { label: string; lat: number; lon: number };

async function solarHousehold(
  at?: Location,
): Promise<{ ctx: HouseholdContext; cell: ReturnType<typeof cellOf>; location: Location }> {
  n += 1;
  const base = await createTestHousehold("prevision-solaire");
  await updateProfile(base, { ...base.profile, solar: true });
  const location = at ?? { label: `Soleil ${n}`, lat: 35 + n / 100, lon: 45 + n / 100 };
  await setLocation(base, location);
  return { ctx: await householdContextFor(base.userId), cell: cellOf(location), location };
}

/** 20 jours de production (1 kWh de 8 h à 16 h UTC) pour un foyer. */
async function production(ctx: HouseholdContext) {
  const rows = [];
  for (let d = -20; d < 0; d++) {
    for (let h = 8; h < 16; h++) {
      rows.push({
        householdId: ctx.householdId,
        metric: "solar_production",
        start: new Date(Date.UTC(2026, 10, 21 + d, h)),
        granularity: "hour" as const,
        kwh: 1, // 0,5 kWh/m² reçus → 2 kWh par kWh/m²
        source: "ha" as const,
      });
    }
  }
  await db.insert(energyInterval).values(rows);
}

/** 20 jours passés (8 h – 15 h UTC, 500 W/m²) et demain (400 W/m²) pour la maille. */
async function weather(cell: ReturnType<typeof cellOf>) {
  const rows = [];
  for (let d = -20; d <= 1; d++) {
    for (let h = 8; h < 16; h++) {
      rows.push({
        ...cell,
        start: new Date(Date.UTC(2026, 10, 21 + d, h)),
        radiationWm2: d === 1 ? 400 : 500,
        temperatureC: 7,
      });
    }
  }
  await db.insert(weatherForecastHourly).values(rows);
}

describe("production solaire prévue", () => {
  it("rendement appris (2 kWh par kWh/m²) appliqué au rayonnement de demain", async () => {
    const { ctx, cell } = await solarHousehold();
    await weather(cell);
    await production(ctx);

    const f = await getSolarForecast(ctx, now);
    expect(f?.method).toBe("learned");
    const tomorrow10 = f?.hours.find((h) => h.start.getTime() === Date.UTC(2026, 10, 22, 10));
    expect(tomorrow10?.kwh).toBeCloseTo(0.8, 6);
    // Aujourd'hui et demain seulement : rien avant minuit local aujourd'hui.
    expect(f?.hours.every((h) => h.start.getTime() >= Date.UTC(2026, 10, 20, 23))).toBe(true);
  });

  it("voisin de la même commune : sa production ne sert pas ; puissance seule → estimation", async () => {
    const neighbour = await solarHousehold();
    await weather(neighbour.cell);
    await production(neighbour.ctx);
    const { ctx } = await solarHousehold(neighbour.location);
    expect(await getSolarForecast(ctx, now)).toBeNull();
    await saveEquipment(ctx, "solar", {
      label: "Panneaux",
      capacity: 3,
      installedOn: "2025-04-01",
      costEur: 6000,
    });
    const f = await getSolarForecast(ctx, now);
    expect(f?.method).toBe("kwc");
    const tomorrow10 = f?.hours.find((h) => h.start.getTime() === Date.UTC(2026, 10, 22, 10));
    expect(tomorrow10?.kwh).toBeCloseTo(0.4 * 3 * 0.8, 6);
  });

  it("sans solaire dans le profil : pas de prévision", async () => {
    const base = await createTestHousehold("prevision-sans-solaire");
    await updateProfile(base, { ...base.profile, solar: false });
    expect(await getSolarForecast(await householdContextFor(base.userId), now)).toBeNull();
  });
});

/** 28 jours horaires : 0,5 kWh achetés à toute heure, 1 kWh produit et exporté de 8 h à 16 h UTC. */
async function hourlyHistory(ctx: HouseholdContext) {
  const rows = [];
  for (let d = -28; d < 0; d++) {
    for (let h = 0; h < 24; h++) {
      const start = new Date(Date.UTC(2026, 10, 21 + d, h));
      const row = (metric: string, kwh: number) => ({
        householdId: ctx.householdId,
        metric,
        start,
        granularity: "hour" as const,
        kwh,
        source: "ha" as const,
      });
      rows.push(row("grid_import", 0.5));
      if (h >= 8 && h < 16) rows.push(row("solar_production", 1), row("grid_export", 1));
    }
  }
  await db.insert(energyInterval).values(rows);
}

describe("aujourd'hui et demain heure par heure (T69)", () => {
  it("consommation du foyer prévue, production, batterie pleine puis surplus exporté", async () => {
    const { ctx, cell } = await solarHousehold();
    await updateProfile(ctx, { ...ctx.profile, solar: true, battery: true });
    await saveEquipment(ctx, "battery", {
      label: "Batterie",
      capacity: 1,
      installedOn: "2025-04-01",
      costEur: 3000,
    });
    await weather(cell);
    await hourlyHistory(ctx);
    const f = await getDayAheadForecast(await householdContextFor(ctx.userId), now);
    // Aujourd'hui et demain : 48 heures (novembre, pas de changement d'heure).
    expect(f?.hours).toHaveLength(48);
    // Consommation = 0,5 achetés + 1 produit − 1 exporté = 0,5 kWh à toute heure.
    expect(f?.hours.every((h) => Math.abs(h.loadKwh - 0.5) < 1e-9)).toBe(true);
    // Demain 10 h UTC : 400 W/m² × 2 = 0,8 kWh produits pour 0,5 consommés.
    const at = (h: number) => f?.hours.find((x) => x.start.getTime() === Date.UTC(2026, 10, 22, h));
    expect(at(10)?.solarKwh).toBeCloseTo(0.8, 6);
    expect(f?.fullAt.map((x) => x.date)).toContain("2026-11-22");
    expect(at(15)?.exportKwh).toBeCloseTo(0.3, 6);
    expect(at(20)?.importKwh).toBeGreaterThan(0);
  });

  it("envoi quotidien : pas de prévision horaire", async () => {
    const base = await createTestHousehold("prevision-quotidien");
    await db
      .update(household)
      .set({ granularity: "daily" })
      .where(eq(household.id, base.householdId));
    expect(await getDayAheadForecast(await householdContextFor(base.userId), now)).toBeNull();
  });
});

describe("prévision chiffrée (T70)", () => {
  it("prix HP/HC du contrat à chaque heure ; le surplus allège le kWh de plus", async () => {
    const { ctx, cell } = await solarHousehold();
    await weather(cell);
    await hourlyHistory(ctx);
    const before = await getPricedForecast(ctx, now);
    expect(before?.priced).toBeNull(); // sans contrat : rien à chiffrer
    await createContract(ctx, {
      name: "Heures creuses",
      contract: {
        kind: "hphc",
        subscriptionEurYear: 236.4,
        prices: { hp: 0.27, hc: 0.2 },
        hcRanges: [{ from: "22:00", to: "06:00" }],
      },
      subscription: { startDate: "2026-01-01", endDate: null },
    });
    const f = await getPricedForecast(ctx, now);
    const at = (h: number) =>
      f?.priced?.hours.find((x) => x.start.getTime() === Date.UTC(2026, 10, 22, h));
    expect(at(2)?.priceEurKwh).toBeCloseTo(0.2, 9); // 3 h locales : heures creuses
    expect(at(18)?.priceEurKwh).toBeCloseTo(0.27, 9);
    // 15 h UTC : 0,3 kWh de surplus (pas de batterie), sans revente.
    expect(at(15)?.kwhCostEur).toBeCloseTo(0.7 * 0.27, 9);
    expect(f?.priced?.exportPriceEur).toBe(0);
  });
});

describe("plan de la page Prévisions (T72)", () => {
  it("créneau de chaque appareil : le lave-linge dans le surplus solaire de demain", async () => {
    const { ctx, cell } = await solarHousehold();
    await weather(cell);
    await hourlyHistory(ctx);
    await createContract(ctx, {
      name: "Base",
      contract: { kind: "base", subscriptionEurYear: 200, priceEurKwh: 0.25 },
      subscription: { startDate: "2026-01-01", endDate: null },
    });
    // 0,3 kWh de surplus par heure demain de 9 h à 17 h locales : 1 h à 0,3 kW tient dedans.
    await saveAppliance(ctx, null, {
      name: "Pompe",
      icon: "plug",
      powerKw: 0.3,
      durationMin: 60,
      allowedFrom: 0,
      allowedTo: 0,
    });
    const plan = await getForecastPlan(ctx, new Date("2026-11-21T20:00:00Z"));
    if (plan.status !== "ok") throw new Error(plan.status);
    expect(plan.days.map((d) => d.date)).toEqual(["2026-11-21", "2026-11-22"]);
    const w = plan.windows[0]?.window;
    expect(w?.solarShare).toBeCloseTo(1, 6);
    expect(w?.costEur).toBeCloseTo(0, 9);
    expect(w?.start.getTime()).toBe(Date.UTC(2026, 10, 22, 8));
  });
});

describe("prévu contre réel (T73)", () => {
  it("la prévision de demain, figée le soir, est comparée aux mesures du lendemain", async () => {
    const { ctx, cell } = await solarHousehold();
    await weather(cell);
    await hourlyHistory(ctx);
    expect(await snapshotForecast(ctx, new Date("2026-11-21T20:00:00Z"))).toBe(24);
    // Le 22 : production réelle de 0,6 kWh par heure de 8 h à 16 h UTC (4,8 kWh), consommation
    // 0,75 kWh à toute heure (18 kWh).
    const rows = [];
    for (let h = 0; h < 24; h++) {
      const start = new Date(Date.UTC(2026, 10, 21, 23) + h * 3_600_000);
      const row = (metric: string, kwh: number) => ({
        householdId: ctx.householdId,
        metric,
        start,
        granularity: "hour" as const,
        kwh,
        source: "ha" as const,
      });
      const sun = start.getUTCHours() >= 8 && start.getUTCHours() < 16;
      rows.push(row("grid_import", sun ? 0.15 : 0.75));
      if (sun) rows.push(row("solar_production", 0.6));
    }
    await db.insert(energyInterval).values(rows);
    const r = await getForecastAccuracy(ctx, new Date("2026-11-23T09:00:00Z"));
    expect(r.days.map((d) => d.date)).toEqual(["2026-11-22"]);
    // Prévu : 8 h × 0,8 kWh de production et 24 × 0,5 kWh de consommation.
    expect(r.days[0]?.solar?.forecast).toBeCloseTo(6.4, 6);
    expect(r.days[0]?.solar?.actual).toBeCloseTo(4.8, 6);
    expect(r.days[0]?.load).toMatchObject({
      forecast: expect.closeTo(12, 6),
      actual: expect.closeTo(18, 6),
    });
    expect(r.loadError).toBeCloseTo(6 / 18, 6);
  });
});

describeTenantIsolation("prévu contre réel", {
  setup: async (b) => {
    const start = Date.UTC(2026, 10, 21, 23);
    await db.insert(householdForecast).values(
      Array.from({ length: 24 }, (_, h) => ({
        householdId: b.householdId,
        start: new Date(start + h * 3_600_000),
        solarKwh: 0,
        loadKwh: 1,
      })),
    );
    await db.insert(energyInterval).values(
      Array.from({ length: 24 }, (_, h) => ({
        householdId: b.householdId,
        metric: "grid_import",
        start: new Date(start + h * 3_600_000),
        granularity: "hour" as const,
        kwh: 1,
        source: "ha" as const,
      })),
    );
    return b.householdId;
  },
  attempt: async (a) => (await getForecastAccuracy(a, new Date("2026-11-23T09:00:00Z"))).days,
  expect: "empty",
});

describe("notification du soir « Créneaux de demain » (T74)", () => {
  it("push et email une seule fois par soir ; rien si elle n'est pas demandée", async () => {
    const { ctx, cell } = await solarHousehold();
    await weather(cell);
    await hourlyHistory(ctx);
    await createContract(ctx, {
      name: "Base",
      contract: { kind: "base", subscriptionEurYear: 200, priceEurKwh: 0.25 },
      subscription: { startDate: "2026-01-01", endDate: null },
    });
    await saveAppliance(ctx, null, {
      name: "Pompe",
      icon: "plug",
      powerKw: 0.3,
      durationMin: 60,
      allowedFrom: 0,
      allowedTo: 0,
    });
    await db.insert(pushSubscription).values({
      householdId: ctx.householdId,
      endpoint: `https://push.test/${ctx.householdId}`,
      p256dh: "cle",
      auth: "secret",
      label: "Test",
    });
    const pushed: string[] = [];
    const mailed: string[] = [];
    const options = {
      now: new Date("2026-11-21T20:00:00Z"),
      origin: "https://wattsup.test",
      send: async (_s: unknown, body: string) => {
        pushed.push(body);
      },
      mail: async (_to: string, c: { subject: string }) => {
        mailed.push(c.subject);
      },
    };
    expect(await notifyTomorrow(ctx, options)).toEqual({ push: 0, email: false });

    await updateTomorrowNotice(ctx, { enabled: true, email: true });
    const fresh = await householdContextFor(ctx.userId, "Test", "test@wattsup.test");
    expect(await notifyTomorrow(fresh, options)).toEqual({ push: 1, email: true });
    expect(JSON.parse(pushed[0] ?? "{}")).toMatchObject({
      title: "Demain, pompe de 9 h à 10 h",
      url: "/previsions",
    });
    expect(mailed).toEqual(["WattsUp : Demain, pompe de 9 h à 10 h"]);

    // Même soir : déjà envoyée.
    const again = await householdContextFor(ctx.userId, "Test", "test@wattsup.test");
    expect(await notifyTomorrow(again, options)).toEqual({ push: 0, email: false });
  });
});

describe("niveau de la batterie envoyé par Home Assistant (T78)", () => {
  it("moins de 3 h : point de départ de la simulation ; plus ancien : ignoré", async () => {
    const { ctx, cell } = await solarHousehold();
    await updateProfile(ctx, { ...ctx.profile, solar: true, battery: true });
    await saveEquipment(ctx, "battery", {
      label: "Batterie",
      capacity: 4,
      installedOn: "2025-04-01",
      costEur: 3000,
    });
    await weather(cell);
    await hourlyHistory(ctx);
    const fresh = await householdContextFor(ctx.userId);
    // Mesurée pleine à 11 h UTC (il est midi) : la batterie couvre la soirée d'aujourd'hui.
    await db.insert(batteryState).values({
      householdId: ctx.householdId,
      socPercent: 100,
      measuredAt: new Date("2026-11-21T11:00:00Z"),
    });
    const f = await getDayAheadForecast(fresh, now);
    expect(f?.batteryMeasured).toMatchObject({ percent: 100 });
    const evening = f?.hours.find((h) => h.start.getTime() === Date.UTC(2026, 10, 21, 17));
    expect(evening?.importKwh).toBe(0);

    await db
      .update(batteryState)
      .set({ measuredAt: new Date("2026-11-21T08:00:00Z") })
      .where(eq(batteryState.householdId, ctx.householdId));
    const stale = await getDayAheadForecast(fresh, now);
    expect(stale?.batteryMeasured).toBeNull();
  });
});

describe("aujourd'hui : le mesuré remplace la prévision des heures écoulées", () => {
  it("heures reçues mesurées, heure en cours prévue ; part mesurée dans le bilan", async () => {
    const { ctx, cell } = await solarHousehold();
    await weather(cell);
    await hourlyHistory(ctx);
    // Aujourd'hui (21 novembre, minuit local = 23 h UTC la veille, déjà dans l'historique à
    // 0,5 kWh) puis de 0 h à 10 h UTC : 2 kWh achetés par heure.
    const rows = [];
    for (let t = Date.UTC(2026, 10, 21, 0); t < Date.UTC(2026, 10, 21, 11); t += 3_600_000) {
      rows.push({
        householdId: ctx.householdId,
        metric: "grid_import",
        start: new Date(t),
        granularity: "hour" as const,
        kwh: 2,
        source: "ha" as const,
      });
    }
    await db.insert(energyInterval).values(rows);
    const plan = await getForecastPlan(ctx, new Date("2026-11-21T11:30:00Z"));
    if (plan.status !== "ok") throw new Error(plan.status);
    const at = (h: number) =>
      plan.hours.find((x) => x.start.getTime() === Date.UTC(2026, 10, 21, h));
    expect(at(10)).toMatchObject({ measured: true, loadKwh: 2, importKwh: 2 });
    expect(at(11)).toMatchObject({ measured: false, loadKwh: 0.5 }); // en cours : prévue
    const today = plan.days[0];
    expect(today?.measured.hours).toBe(12);
    expect(today?.measured.loadKwh).toBeCloseTo(0.5 + 11 * 2, 6);
    expect(plan.days[1]?.measured.hours).toBe(0);
  });
});
