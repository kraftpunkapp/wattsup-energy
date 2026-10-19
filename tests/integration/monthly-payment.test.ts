import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { contract, energyInterval } from "@/db/schema";
import { addDays, eachDay, zonedInstant } from "@/lib/time";
import type { HouseholdContext } from "@/server/context";
import {
  ContractError,
  createContract,
  listContracts,
  setMonthlyPayment,
} from "@/server/contracts";
import { getPaymentAnalysis } from "@/server/queries/contracts";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

// Mensualité du contrat (T59, SPEC §7.13) : saisie sur un contrat souscrit et verdict sur la
// consommation réelle. Même profil que les tests du domaine : 20 kWh/j de novembre à mars,
// 8 kWh/j sinon, Base à 0,25 €/kWh et 240 €/an → 1 423 € attendus sur 365 jours.

const TZ = "Europe/Paris";
const now = new Date("2026-10-19T08:00:00Z");
const today = "2026-10-19";
const winter = (day: string) => [11, 12, 1, 2, 3].includes(Number(day.slice(5, 7)));

async function dailyImport(householdId: string, days: number) {
  await db.insert(energyInterval).values(
    eachDay(addDays(today, -days), today).map((date) => ({
      householdId,
      metric: "grid_import",
      start: zonedInstant(date, 0, TZ),
      granularity: "day" as const,
      tariffSlot: "all" as const,
      kwh: winter(date) ? 20 : 8,
      source: "ha" as const,
    })),
  );
}

const subscribed = (ctx: HouseholdContext) =>
  createContract(ctx, {
    name: "Mon contrat",
    contract: { kind: "base", subscriptionEurYear: 240, priceEurKwh: 0.25 },
    subscription: { startDate: "2024-01-01", endDate: null },
  });

describe("mensualité du contrat", () => {
  it("se renseigne et se retire sur un contrat souscrit", async () => {
    const ctx = await createTestHousehold("mensualite");
    const c = await subscribed(ctx);
    const payment = { amountCents: 11900, paymentsPerYear: 11 as const, settlementMonth: 3 };
    await setMonthlyPayment(ctx, c?.id ?? "", payment);
    expect((await listContracts(ctx))[0]?.payment).toEqual(payment);
    await setMonthlyPayment(ctx, c?.id ?? "", null);
    expect((await listContracts(ctx))[0]?.payment).toBeNull();
  });

  it("refusée pour une offre simulée", async () => {
    const ctx = await createTestHousehold("mensualite");
    const c = await createContract(ctx, {
      name: "Offre",
      contract: { kind: "base", subscriptionEurYear: 240, priceEurKwh: 0.2 },
      subscription: null,
    });
    await expect(
      setMonthlyPayment(ctx, c?.id ?? "", {
        amountCents: 10000,
        paymentsPerYear: 12,
        settlementMonth: null,
      }),
    ).rejects.toThrow(ContractError);
  });

  it("verdict sur 12 mois réels ; sans mensualité, rien ; sous 12 mois, pas de verdict", async () => {
    const ctx = await createTestHousehold("mensualite");
    await dailyImport(ctx.householdId, 365);
    const c = await subscribed(ctx);
    expect(await getPaymentAnalysis(ctx, now)).toBeNull();

    await setMonthlyPayment(ctx, c?.id ?? "", {
      amountCents: 10000,
      paymentsPerYear: 12,
      settlementMonth: 3,
    });
    const r = await getPaymentAnalysis(ctx, now);
    expect(r?.contractId).toBe(c?.id);
    expect(r?.analysis).toMatchObject({
      status: "ok",
      verdict: "low",
      expectedAnnualCents: 142300,
      advisedCents: 11900,
      settlement: { month: "2027-03" },
    });

    const recent = await createTestHousehold("mensualite");
    await dailyImport(recent.householdId, 90);
    const rc = await subscribed(recent);
    await setMonthlyPayment(recent, rc?.id ?? "", {
      amountCents: 10000,
      paymentsPerYear: 12,
      settlementMonth: null,
    });
    expect((await getPaymentAnalysis(recent, now))?.analysis).toEqual({
      status: "insufficient",
      months: 3,
    });
  });
});

describeTenantIsolation("mensualité d'un contrat", {
  setup: async (b) => (await subscribed(b))?.id ?? "",
  attempt: (a, id) =>
    setMonthlyPayment(a, id, { amountCents: 100, paymentsPerYear: 12, settlementMonth: null }),
  expect: "empty",
  untouched: async (_b, id) => {
    const [row] = await db.select().from(contract).where(eq(contract.id, id));
    expect(row?.monthlyPaymentCents).toBeNull();
  },
});
