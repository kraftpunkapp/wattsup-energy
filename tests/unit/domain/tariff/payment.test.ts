import { describe, expect, it } from "vitest";
import {
  analyzePayment,
  billingYear,
  parseMonthlyPayment,
  type MonthlyPayment,
} from "@/domain/tariff/payment";
import type { DatedContract } from "@/domain/tariff/timeline";
import type { BaseContract, PriceableInterval } from "@/domain/tariff/types";
import { addDays, eachDay } from "@/lib/time";

// Mensualité du contrat (T59, SPEC §7.13). Profil saisonnier : 20 kWh par jour de novembre à
// mars, 8 kWh le reste de l'année ; contrat Base à 0,25 €/kWh et 240 €/an d'abonnement.
// Sur n'importe quelle fenêtre de 365 jours (sans 29 février) : 151 jours d'hiver, 214 d'été,
// soit 151 × 20 + 214 × 8 = 4 732 kWh → 1 183 € + 240 € = 1 423 € attendus par an.

const TZ = "Europe/Paris";
const grid: BaseContract = { kind: "base", subscriptionEurYear: 240, priceEurKwh: 0.25 };
const B: DatedContract = {
  id: "B",
  name: "Actuel",
  status: "subscribed",
  startDate: "2024-01-01",
  endDate: null,
  periods: [{ validFrom: "2024-01-01", contract: grid }],
};
const winter = (day: string) => [11, 12, 1, 2, 3].includes(Number(day.slice(5, 7)));
/** Un total journalier par jour de [from, to). */
const days = (from: string, to: string): PriceableInterval[] =>
  eachDay(from, to).map((date) => ({
    granularity: "day",
    date,
    slot: null,
    kwh: winter(date) ? 20 : 8,
  }));

const input = (payment: MonthlyPayment, today: string, contracts = [B], periodDays = 365) => {
  const from = addDays(today, -periodDays);
  return {
    payment,
    today,
    from,
    periodDays,
    intervals: days(from, today),
    contracts,
    current: { contract: grid, startDate: contracts.at(-1)?.startDate ?? null },
    pricing: { timezone: TZ },
  };
};
const pay = (
  euros: number,
  paymentsPerYear: 10 | 11 | 12 = 12,
  settlementMonth: number | null = null,
) => ({
  amountCents: euros * 100,
  paymentsPerYear,
  settlementMonth,
});

describe("billingYear", () => {
  it("se termine à la fin du mois de régularisation à venir, ce mois-ci compris", () => {
    expect(billingYear("2026-10-19", 3)).toEqual({
      from: "2026-04-01",
      to: "2027-04-01",
      settlement: "2027-03",
    });
    expect(billingYear("2026-10-19", 10)).toEqual({
      from: "2025-11-01",
      to: "2026-11-01",
      settlement: "2026-10",
    });
    expect(billingYear("2026-10-19", 12)).toEqual({
      from: "2026-01-01",
      to: "2027-01-01",
      settlement: "2026-12",
    });
  });
});

describe("analyzePayment", () => {
  it("moins de 12 mois de données : pas de verdict, nombre de mois connus", () => {
    expect(analyzePayment(input(pay(119), "2026-10-19", [B], 200))).toEqual({
      status: "insufficient",
      months: 7,
    });
  });

  it("bien ajustée à 5 % près : prélevé sur l'année contre coût attendu", () => {
    const r = analyzePayment(input(pay(119), "2026-10-19"));
    expect(r).toMatchObject({
      status: "ok",
      verdict: "ok",
      paidAnnualCents: 142800,
      expectedAnnualCents: 142300,
      advisedCents: 11900, // 1 423 € ÷ 12 = 118,58 €, arrondi à l'euro supérieur
      settlement: null,
    });
  });

  it("trop basse ou trop élevée, selon le nombre de prélèvements", () => {
    expect(analyzePayment(input(pay(100), "2026-10-19"))).toMatchObject({
      verdict: "low",
      advisedCents: 11900,
    });
    // 11 prélèvements de 140 € = 1 540 € pour 1 423 € attendus (+8 %).
    expect(analyzePayment(input(pay(140, 11), "2026-10-19"))).toMatchObject({
      verdict: "high",
      paidAnnualCents: 154000,
      advisedCents: 13000, // 1 423 € ÷ 11 = 129,36 €
    });
  });

  it("l'hiver ne fausse pas le verdict : même résultat en avril et en octobre", () => {
    const april = analyzePayment(input(pay(119), "2026-04-15"));
    const october = analyzePayment(input(pay(119), "2026-10-19"));
    expect(april).toMatchObject({ verdict: "ok", expectedAnnualCents: 142300 });
    expect(october).toMatchObject({ verdict: "ok", expectedAnnualCents: 142300 });
  });

  it("régularisation : réel depuis le début de l'année de facturation, reste estimé un an plus tôt", () => {
    // Facturation du 1er avril 2026 au 31 mars 2027. Réel : 201 jours d'été (1 608 kWh) ;
    // reste : du 19 octobre 2025 au 31 mars 2026, 13 jours d'été et 151 d'hiver (3 124 kWh).
    const r = analyzePayment(input(pay(119, 12, 3), "2026-10-19"));
    const subscription = Math.round((24000 * 201) / 365) + Math.round((24000 * 164) / 365);
    const cost = 1608 * 25 + 3124 * 25 + subscription;
    expect(r).toMatchObject({ settlement: { month: "2027-03", balanceCents: cost - 142800 } });
  });

  it("contrat commencé en cours d'année : prélèvements au prorata, réel depuis la souscription", () => {
    const previous: DatedContract = {
      ...B,
      id: "A",
      startDate: "2024-01-01",
      endDate: "2026-05-31",
      periods: [{ validFrom: "2024-01-01", contract: { ...grid, priceEurKwh: 0.1 } }],
    };
    const current: DatedContract = { ...B, startDate: "2026-06-01" };
    const r = analyzePayment(input(pay(119, 12, 3), "2026-10-19", [previous, current]));
    // Réel du 1er juin au 18 octobre : 140 jours d'été (1 120 kWh) au prix du contrat actuel.
    const cost =
      1120 * 25 + Math.round((24000 * 140) / 365) + 3124 * 25 + Math.round((24000 * 164) / 365);
    const paid = Math.round((142800 * 304) / 365); // du 1er juin au 31 mars
    expect(r).toMatchObject({ settlement: { month: "2027-03", balanceCents: cost - paid } });
  });
});

describe("parseMonthlyPayment", () => {
  it("montant en euros (virgule ou point), prélèvements et mois facultatif", () => {
    expect(
      parseMonthlyPayment({ amount: "85,50", paymentsPerYear: 11, settlementMonth: 3 }),
    ).toEqual({
      ok: true,
      value: { amountCents: 8550, paymentsPerYear: 11, settlementMonth: 3 },
    });
    expect(
      parseMonthlyPayment({ amount: "120", paymentsPerYear: 12, settlementMonth: null }),
    ).toEqual({
      ok: true,
      value: { amountCents: 12000, paymentsPerYear: 12, settlementMonth: null },
    });
  });

  it("refus en français : montant hors bornes, prélèvements ou mois invalides", () => {
    const errors = (raw: unknown) => {
      const r = parseMonthlyPayment(raw);
      return r.ok ? [] : r.errors;
    };
    expect(errors({ amount: "0", paymentsPerYear: 12, settlementMonth: null })).toEqual([
      "mensualité entre 1 et 2 000 €",
    ]);
    expect(errors({ amount: "abc", paymentsPerYear: 12, settlementMonth: null })).toEqual([
      "mensualité entre 1 et 2 000 €",
    ]);
    expect(errors({ amount: "80", paymentsPerYear: 9, settlementMonth: 13 })).toEqual([
      "10, 11 ou 12 prélèvements par an",
      "mois de régularisation invalide",
    ]);
  });
});
