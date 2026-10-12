import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { energyInterval, tempoOverride } from "@/db/schema";
import { priceIntervals } from "@/domain/tariff/engine";
import { CONTRACT_PRESETS } from "@/domain/tariff/schema";
import { createContract } from "@/server/contracts";
import { updateGranularity } from "@/server/household";
import { getContractComparison } from "@/server/queries/contracts";
import { setManualTempoColor, tempoCalendarView } from "@/server/tempo/sync";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

const now = new Date("2026-10-03T10:00:00Z");

const preset = (i: number) => {
  const p = CONTRACT_PRESETS[i];
  if (!p) throw new Error(`offre ${i} absente`);
  return p;
};

/** `days` jours d'import horaire (1 kWh/h) se terminant la veille de `now`. */
async function hourlyImport(householdId: string, days: number) {
  const end = Date.parse("2026-10-02T22:00:00Z"); // 3 oct. 00:00 Paris
  const rows = [];
  for (let t = end - days * 24 * 3_600_000; t < end; t += 3_600_000) {
    rows.push({
      householdId,
      metric: "grid_import",
      start: new Date(t),
      granularity: "hour" as const,
      kwh: 1,
      source: "ha" as const,
    });
  }
  await db.insert(energyInterval).values(rows);
  return rows;
}

describe("getContractComparison", () => {
  it("sans donnée : no-data ; moins de 7 jours : insufficient", async () => {
    const ctx = await createTestHousehold();
    expect(await getContractComparison(ctx, now)).toEqual({ status: "no-data" });
    await hourlyImport(ctx.householdId, 3);
    expect(await getContractComparison(ctx, now)).toEqual({ status: "insufficient", days: 3 });
  });

  it("30 jours horaires : coûts du moteur, annualisation, couverture complète", async () => {
    const ctx = await createTestHousehold();
    const rows = await hourlyImport(ctx.householdId, 30);
    // Base souscrit depuis 2026-01-01 ; les autres offres simulées.
    for (const p of CONTRACT_PRESETS) {
      await createContract(ctx, {
        ...p,
        subscription:
          p.contract.kind === "base" ? { startDate: "2026-01-01", endDate: null } : null,
      });
    }
    const r = await getContractComparison(ctx, now);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r).toMatchObject({ from: "2026-09-03", to: "2026-10-03", periodDays: 30, kwh: 720 });
    expect(r.coverage).toBe(1);
    expect(r.rows).toHaveLength(CONTRACT_PRESETS.length);
    const base = r.rows.find((c) => c.contract.kind === "base");
    const expected = priceIntervals(
      rows.map((x) => ({ granularity: "hour" as const, start: x.start, kwh: x.kwh })),
      preset(0).contract,
      { timezone: "Europe/Paris", period: { from: "2026-09-03", to: "2026-10-03" } },
    );
    expect(base?.totalCents).toBe(expected.totalCents);
    expect(r.rows.find((c) => c.isCurrent)?.contract.kind).toBe("base");
    // Base souscrit sur toute la période : le coût réel égale sa simulation.
    expect(r.real).toEqual({
      totalCents: expected.totalCents,
      annualCents: base?.annualCents,
      unknownContractDays: 0,
    });
  });

  it("couverture partielle : heures manquantes comptées", async () => {
    const ctx = await createTestHousehold();
    const rows = await hourlyImport(ctx.householdId, 10);
    await db.delete(energyInterval); // repart à vide pour ce foyer et les autres
    await db.insert(energyInterval).values(rows.filter((_, i) => i % 2 === 0));
    await createContract(ctx, {
      ...preset(0),
      subscription: { startDate: "2026-01-01", endDate: null },
    });
    const r = await getContractComparison(ctx, now);
    expect(r.status === "ok" && r.coverage).toBeCloseTo(0.5, 5);
  });

  it("jours rouges : couleur du foyer prioritaire", async () => {
    const ctx = await createTestHousehold();
    await hourlyImport(ctx.householdId, 10);
    await createContract(ctx, {
      ...preset(2),
      subscription: { startDate: "2026-01-01", endDate: null },
    });
    await db.insert(tempoOverride).values([
      { householdId: ctx.householdId, date: "2026-09-28", color: "rouge", source: "manual" },
      { householdId: ctx.householdId, date: "2026-09-29", color: "rouge", source: "ha" },
    ]);
    const r = await getContractComparison(ctx, now);
    expect(r.status === "ok" && r.redDays).toBe(2);
  });

  it("mode quotidien : couverture en jours", async () => {
    const ctx = await createTestHousehold();
    await updateGranularity(ctx, "daily");
    const rows = [];
    for (let d = 1; d <= 8; d++) {
      const day = `2026-09-${String(20 + d).padStart(2, "0")}`;
      const start = new Date(`${day}T00:00:00+02:00`);
      for (const [slot, kwh] of [
        ["hp", 8],
        ["hc", 4],
      ] as const) {
        rows.push({
          householdId: ctx.householdId,
          metric: "grid_import",
          start,
          granularity: "day" as const,
          tariffSlot: slot,
          kwh,
          source: "ha" as const,
        });
      }
    }
    await db.insert(energyInterval).values(rows);
    await createContract(ctx, {
      ...preset(1),
      subscription: { startDate: "2026-01-01", endDate: null },
    });
    const r = await getContractComparison({ ...ctx, granularity: "daily" }, now);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.periodDays).toBe(12); // du 21/09 au 03/10
    expect(r.coverage).toBeCloseTo(8 / 12, 5);
    expect(r.kwh).toBe(96);
  });
});

describe("calendrier Tempo du foyer", () => {
  it("une correction manuelle s'affiche, puis se retire", async () => {
    const ctx = await createTestHousehold();
    await setManualTempoColor(ctx.householdId, "2026-01-15", "rouge");
    expect(
      (await tempoCalendarView(ctx.householdId, "2026-01-15", "2026-01-15")).get("2026-01-15"),
    ).toEqual({
      color: "rouge",
      source: "manual",
    });
    await setManualTempoColor(ctx.householdId, "2026-01-15", null);
    expect(
      (await tempoCalendarView(ctx.householdId, "2026-01-15", "2026-01-15")).get("2026-01-15")
        ?.source,
    ).not.toBe("manual");
  });
});

describeTenantIsolation("comparaison des contrats", {
  setup: async (b) => {
    await hourlyImport(b.householdId, 10);
    await createContract(b, {
      ...preset(0),
      subscription: { startDate: "2026-01-01", endDate: null },
    });
    return b.householdId;
  },
  attempt: async (a) => {
    const r = await getContractComparison(a, now);
    return r.status === "ok" ? r.rows : [];
  },
  expect: "empty",
});
