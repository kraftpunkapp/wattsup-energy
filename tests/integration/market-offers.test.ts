import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { energyInterval, marketImport, marketOffer, marketSync, spotPrice } from "@/db/schema";
import type { HouseholdContext } from "@/server/context";
import { householdContextFor } from "@/server/context";
import { ContractError, createContract, listContracts } from "@/server/contracts";
import { addMarketOffer, getMarketOffers, knownMarketSaving } from "@/server/market/compare";
import { MANIFEST_PATH, type OfferSource } from "@/server/market/source";
import { syncMarket } from "@/server/market/sync";
import { updateMeterPower } from "@/server/settings";
import { alertFacts } from "@/server/alerts";
import { comparisonInputs } from "@/server/queries/contracts";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

// Offres du marché sur la page Contrats (T55, SPEC §7.12) : catalogue importé depuis les
// fixtures, rejoué sur la consommation du foyer avec son contrat actuel comme référence.

const now = new Date("2026-10-03T10:00:00Z");
const ROOT = join(__dirname, "../fixtures/market");
const PATHS = [
  "scripts/tarifs/edf/bleu.js",
  "scripts/tarifs/edf/tempo.js",
  "scripts/tarifs/edf/zenEstival.js",
];

const source: OfferSource = {
  latestCommit: async () => ({ sha: "c".repeat(40), date: new Date("2026-10-02T11:00:00Z") }),
  file: async (_sha, path) =>
    path === MANIFEST_PATH
      ? `export const TARIF_SCRIPTS = [${PATHS.map((p) => `"${p}"`).join(", ")}];`
      : readFileSync(join(ROOT, path), "utf8"),
};

/** 30 jours d'import horaire (1 kWh/h) se terminant la veille de `now`. */
async function hourlyImport(householdId: string) {
  const end = Date.parse("2026-10-02T22:00:00Z");
  const rows = [];
  for (let t = end - 30 * 24 * 3_600_000; t < end; t += 3_600_000) {
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
}

/** Foyer avec 30 jours de données et un contrat Base cher souscrit. */
async function householdWithData(label: string, kva: number | null = 9) {
  const ctx = await createTestHousehold(label);
  await hourlyImport(ctx.householdId);
  await createContract(ctx, {
    name: "Mon contrat",
    contract: { kind: "base", subscriptionEurYear: 260, priceEurKwh: 0.27 },
    subscription: { startDate: "2026-01-01", endDate: null },
  });
  if (kva !== null) await updateMeterPower(ctx, kva);
  return householdContextFor(ctx.userId);
}

beforeAll(async () => {
  await db.delete(marketOffer);
  await db.delete(marketImport);
  await db.delete(marketSync);
});

describe("prix spot lus seulement s'ils servent (T64)", () => {
  it("puissance connue en envoi horaire, ou contrat spot ; sinon aucun", async () => {
    const start = Date.parse("2026-09-15T00:00:00Z");
    await db
      .insert(spotPrice)
      .values(
        Array.from({ length: 24 }, (_, h) => ({
          start: new Date(start + h * 3_600_000),
          eurMwh: 80,
        })),
      )
      .onConflictDoNothing();
    const spotHours = async (ctx: HouseholdContext) => {
      const inputs = await comparisonInputs(ctx, now);
      return inputs.status === "ok" ? inputs.spotHours : -1;
    };
    expect(await spotHours(await householdWithData("spot-power"))).toBeGreaterThanOrEqual(24);
    const noPower = await householdWithData("spot-nopower", null);
    expect(await spotHours(noPower)).toBe(0);
    await createContract(noPower, {
      name: "Spot",
      contract: {
        kind: "spot",
        subscriptionEurYear: 300,
        formula: {
          network: { winter: 0.06, summer: 0.015 },
          excise: 0.03,
          cap: null,
          fees: 0.02,
          vat: 0.2,
        },
      },
      subscription: null,
    });
    expect(await spotHours(await householdContextFor(noPower.userId))).toBeGreaterThanOrEqual(24);
  });
});

describe("offres du marché", () => {
  it("sans catalogue : rien à afficher", async () => {
    const ctx = await householdWithData("market-none");
    expect(await getMarketOffers(ctx, now)).toEqual({ status: "no-catalog" });
  });

  it("sans puissance du compteur : à renseigner", async () => {
    await syncMarket(source);
    const ctx = await householdWithData("market-nopower", null);
    expect(await getMarketOffers(ctx, now)).toEqual({ status: "no-power" });
  });

  it("classement, écart avec le contrat actuel, offres pas encore comparables", async () => {
    const ctx = await householdWithData("market-ok");
    const r = await getMarketOffers(ctx, now);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.kva).toBe(9);
    expect(r.rows.map((o) => o.name)).toEqual(
      expect.arrayContaining(["EDF - Bleu", "EDF - Bleu Heures Creuses", "EDF - Tempo"]),
    );
    expect(r.rows.every((o) => o.deltaAnnualCents !== null && o.deltaAnnualCents < 0)).toBe(true);
    expect(r.pending).toEqual([]);
    expect(r.rows.map((o) => o.name)).toContain("EDF - Zen Estival");
    expect(r.catalogDate).toEqual(new Date("2026-10-02T11:00:00Z"));
    // Gardé en mémoire : l'alerte lit l'économie sans recalculer.
    expect(knownMarketSaving(ctx.householdId)).toEqual({
      name: r.rows[0]?.name,
      savingCents: -(r.rows[0]?.deltaAnnualCents ?? 0),
    });
    expect((await alertFacts(ctx, now)).market?.name).toBe(r.rows[0]?.name);
    expect(await getMarketOffers(ctx, now)).toBe(r);
  });

  it("une autre puissance : autre grille, nouveau calcul", async () => {
    const ctx = await householdWithData("market-power");
    const nine = await getMarketOffers(ctx, now);
    await updateMeterPower(ctx, 3);
    const three = await getMarketOffers(await householdContextFor(ctx.userId), now);
    if (nine.status !== "ok" || three.status !== "ok") throw new Error("statut");
    expect(three.rows.map((o) => o.name).sort()).toEqual(["EDF - Bleu", "EDF - Zen Estival"]);
    expect(three.unavailable).toBe(2);
  });

  it("ajouter à mes offres : offre simulée, une seule fois", async () => {
    const ctx = await householdWithData("market-add");
    await addMarketOffer(ctx, "EDF - Tempo");
    const added = (await listContracts(ctx)).find((c) => c.name === "EDF - Tempo");
    expect(added).toMatchObject({ kind: "tempo", status: "simulated" });
    expect(added?.periods[0]?.contract).toMatchObject({ subscriptionEurYear: 236.4 });
    await expect(addMarketOffer(ctx, "EDF - Tempo")).rejects.toThrow(ContractError);
    await expect(addMarketOffer(ctx, "Inconnue")).rejects.toThrow(/introuvable/);
  });
});

describeTenantIsolation<HouseholdContext>("offres du marché", {
  setup: async (b) => {
    await syncMarket(source);
    await hourlyImport(b.householdId);
    await updateMeterPower(b, 9);
    return b;
  },
  attempt: async (a) => {
    await updateMeterPower(a, 9);
    const r = await getMarketOffers(await householdContextFor(a.userId), now);
    return r.status === "ok" ? r.rows : [];
  },
  expect: "empty",
});
