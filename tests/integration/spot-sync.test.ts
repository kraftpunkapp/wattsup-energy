import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { contract, energyInterval, spotPrice } from "@/db/schema";
import { pricingDays } from "@/server/calendars";
import { createContract } from "@/server/contracts";
import type { SpotSource } from "@/server/spot/source";
import { syncSpot } from "@/server/spot/sync";
import { createTestHousehold } from "../helpers/tenancy";

// Prix spot globaux (T58) : historique puis reprise depuis le dernier jour connu ; un mois
// en échec n'arrête pas les autres ; chargés pour un foyer qui en a besoin.

beforeEach(async () => {
  await db.delete(spotPrice);
});

const noPause = async () => {};

function fakeSource(fail: string[] = []) {
  const calls: [string, string][] = [];
  const source: SpotSource = {
    prices: async (from, to) => {
      calls.push([from, to]);
      if (fail.includes(from.slice(0, 7))) throw new Error("HTTP 503");
      // Une heure par jour demandé, à midi UTC, prix = jour du mois.
      const out = [];
      for (
        let d = new Date(`${from}T12:00:00Z`);
        d <= new Date(`${to}T12:00:00Z`);
        d = new Date(d.getTime() + 86_400_000)
      ) {
        out.push({ start: d, eurMwh: d.getUTCDate() });
      }
      return out;
    },
  };
  return { source, calls };
}

describe("synchronisation des prix spot", () => {
  it("historique depuis janvier 2023, puis reprise à partir des deux derniers jours", async () => {
    const now = new Date("2023-03-10T15:00:00Z");
    const { source, calls } = fakeSource();
    const r = await syncSpot(source, now, noPause);
    expect(calls).toEqual([["2023-01-01", "2023-03-11"]]);
    expect(r).toEqual({ hours: 31 + 28 + 11, failed: [] });

    const again = fakeSource();
    await syncSpot(again.source, new Date("2023-03-12T15:00:00Z"), noPause);
    expect(again.calls).toEqual([["2023-03-09", "2023-03-13"]]);
    expect(await db.$count(spotPrice)).toBe(31 + 28 + 13);
  });

  it("une période en échec arrête le passage, repris ensuite sans trou", async () => {
    const { source } = fakeSource(["2023-07"]);
    const r = await syncSpot(source, new Date("2023-08-02T15:00:00Z"), noPause);
    expect(r.failed).toEqual(["2023-07"]);
    expect(await db.$count(spotPrice)).toBe(181);
    const again = fakeSource();
    await syncSpot(again.source, new Date("2023-08-02T15:00:00Z"), noPause);
    expect(again.calls[0]).toEqual(["2023-06-28", "2023-08-03"]);
    expect(await db.$count(spotPrice)).toBe(181 + 34);
  });
});

describe("trou dans l'historique", () => {
  it("un jour sans prix est repris au passage suivant", async () => {
    await syncSpot(fakeSource().source, new Date("2023-03-10T15:00:00Z"), noPause);
    await db.delete(spotPrice).where(sql`${spotPrice.start}::date = '2023-02-14'`);
    const again = fakeSource();
    await syncSpot(again.source, new Date("2023-03-10T15:00:00Z"), noPause);
    expect(again.calls[0]?.[0]).toBe("2023-02-14");
    expect(await db.$count(spotPrice)).toBe(31 + 28 + 11);
  });
});

describe("prix spot dans les calculs", () => {
  it("lus seulement pour un foyer qui a un contrat spot, ou sur demande", async () => {
    await syncSpot(fakeSource().source, new Date("2023-01-20T15:00:00Z"), noPause);
    const ctx = await createTestHousehold("spot");
    const range = ["2023-01-10", "2023-01-12"] as const;
    expect((await pricingDays(ctx.householdId, ...range)).spotHours).toBe(0);
    expect((await pricingDays(ctx.householdId, ...range, { spot: true })).spotHours).toBe(3);

    await createContract(ctx, {
      name: "Spot",
      contract: {
        kind: "spot",
        subscriptionEurYear: 0,
        formula: {
          network: { winter: 0, summer: 0 },
          excise: 0,
          cap: null,
          fees: 0,
          vat: 0,
        },
      },
      subscription: null,
    });
    const days = await pricingDays(ctx.householdId, ...range);
    expect(days.spotHours).toBe(3);
    expect(days.calendars.spotPrice?.(new Date("2023-01-11T12:00:00Z"))).toBe(11);
    expect(days.calendars.spotFallback).toBe(11);
    await db.delete(contract);
    await db.delete(energyInterval);
  });
});
