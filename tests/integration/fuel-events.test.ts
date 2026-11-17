import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { fuelEvent } from "@/db/schema";
import type { HouseholdContext } from "@/server/context";
import {
  addPastConsumption,
  addPurchase,
  addQuickConsumption,
  deleteFuelEvent,
  FuelError,
  fuelStock,
  listFuelEvents,
  setStock,
  updateFuelEvent,
} from "@/server/fuel";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

describe("combustibles", () => {
  it("achat d'une palette, sacs versés, relevé : stock calculé en kg", async () => {
    const ctx = await createTestHousehold();
    await addPurchase(ctx, {
      fuel: "pellet",
      qty: 1,
      unit: "pallet",
      priceEur: 420,
      date: "2025-09-01",
    });
    const events = await listFuelEvents(ctx);
    // la palette est enregistrée en sacs (66 par défaut), à midi heure de Paris
    expect(events[0]).toMatchObject({ qty: 66, unit: "bag", priceEur: 420 });
    expect(events[0]?.at.toISOString()).toBe("2025-09-01T10:00:00.000Z");

    await addQuickConsumption(ctx, "pellet", new Date("2025-10-20T19:00:00Z"));
    await addQuickConsumption(ctx, "pellet", new Date("2025-10-21T19:00:00Z"));
    expect(await fuelStock(ctx, "pellet", new Date("2025-10-22T00:00:00Z"))).toBe(64 * 15);

    await setStock(ctx, { fuel: "pellet", qty: 50, unit: "bag" }, new Date("2025-11-01T09:00:00Z"));
    expect(await fuelStock(ctx, "pellet", new Date("2025-11-02T00:00:00Z"))).toBe(50 * 15);
  });

  it("consommation passée : total d'un mois terminé, daté du 15 à midi ; mois en cours refusé", async () => {
    const ctx = await createTestHousehold();
    const now = new Date("2026-10-05T08:00:00Z");
    await addPastConsumption(ctx, { fuel: "pellet", qty: 42, unit: "bag", month: "2025-01" }, now);
    const [event] = await listFuelEvents(ctx);
    expect(event).toMatchObject({ type: "consumption", qty: 42, unit: "bag" });
    expect(event?.at.toISOString()).toBe("2025-01-15T11:00:00.000Z");
    await expect(
      addPastConsumption(ctx, { fuel: "pellet", qty: 1, unit: "bag", month: "2026-10" }, now),
    ).rejects.toThrow(FuelError);
    await expect(
      addPastConsumption(ctx, { fuel: "wood", qty: 1, unit: "bag", month: "2025-01" }, now),
    ).rejects.toThrow(FuelError);
  });

  it("bois : ½ stère par tap ; unité incohérente refusée", async () => {
    const ctx = await createTestHousehold();
    const row = await addQuickConsumption(ctx, "wood");
    expect(row).toMatchObject({ fuel: "wood", qty: 0.5, unit: "stere", type: "consumption" });
    await expect(
      addPurchase(ctx, { fuel: "wood", qty: 2, unit: "bag", priceEur: 100, date: "2025-09-01" }),
    ).rejects.toThrow(FuelError);
    await expect(
      updateFuelEvent(ctx, row?.id ?? "", {
        qty: 1,
        unit: "kg",
        priceEur: null,
        date: null,
      }),
    ).rejects.toThrow(FuelError);
  });

  it("chronologie ; modifier puis annuler (supprimer) un événement", async () => {
    const ctx = await createTestHousehold();
    const p = await addPurchase(ctx, {
      fuel: "pellet",
      qty: 10,
      unit: "bag",
      priceEur: 70,
      date: "2025-09-01",
    });
    const c = await addQuickConsumption(ctx, "pellet", new Date("2025-10-20T19:00:00Z"));
    expect((await listFuelEvents(ctx)).map((e) => e.type)).toEqual(["purchase", "consumption"]);

    await updateFuelEvent(ctx, p?.id ?? "", {
      qty: 12,
      unit: "bag",
      priceEur: 84,
      date: "2025-09-02",
    });
    expect((await listFuelEvents(ctx))[0]).toMatchObject({ qty: 12, priceEur: 84 });

    expect(await deleteFuelEvent(ctx, c?.id ?? "")).toBe(true);
    expect(await listFuelEvents(ctx)).toHaveLength(1);
  });

  it("modifier le jour d'une consommation ou d'un relevé le date à midi local", async () => {
    const ctx = await createTestHousehold();
    const c = await addQuickConsumption(ctx, "pellet", new Date("2025-10-20T19:00:00Z"));
    const s = await setStock(
      ctx,
      { fuel: "pellet", qty: 5, unit: "bag" },
      new Date("2025-11-01T09:00:00Z"),
    );
    await updateFuelEvent(ctx, c?.id ?? "", {
      qty: 1,
      unit: "bag",
      priceEur: null,
      date: "2025-10-18",
    });
    await updateFuelEvent(ctx, s?.id ?? "", {
      qty: 5,
      unit: "bag",
      priceEur: null,
      date: "2025-10-30",
    });
    const events = await listFuelEvents(ctx);
    expect(events.map((e) => [e.type, e.at.toISOString()])).toEqual([
      ["consumption", "2025-10-18T10:00:00.000Z"],
      ["stock_snapshot", "2025-10-30T11:00:00.000Z"],
    ]);
  });
});

const ownedByB = async (b: HouseholdContext) =>
  (await addPurchase(b, { fuel: "pellet", qty: 10, unit: "bag", priceEur: 70, date: "2025-09-01" }))
    ?.id ?? "";
const untouched = async (_b: HouseholdContext, id: string) => {
  const [row] = await db.select().from(fuelEvent).where(eq(fuelEvent.id, id));
  expect(row).toMatchObject({ qty: 10, priceEur: 70 });
};

describeTenantIsolation("liste des combustibles", {
  setup: ownedByB,
  attempt: (a) => listFuelEvents(a),
  expect: "empty",
});
describeTenantIsolation("stock", {
  setup: ownedByB,
  attempt: async (a) => ((await fuelStock(a, "pellet")) === 0 ? [] : ["fuite"]),
  expect: "empty",
});
describeTenantIsolation("modification d'un événement", {
  setup: ownedByB,
  attempt: (a, id) => updateFuelEvent(a, id, { qty: 1, unit: "bag", priceEur: 1, date: null }),
  expect: "empty",
  untouched,
});
describeTenantIsolation("suppression d'un événement", {
  setup: ownedByB,
  attempt: async (a, id) => ((await deleteFuelEvent(a, id)) ? ["supprimé"] : []),
  expect: "empty",
  untouched,
});
