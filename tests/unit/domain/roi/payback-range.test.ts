import { describe, expect, it } from "vitest";
import { nextMilestone, paybackRange, recentSavings } from "@/domain/roi/payback";

const months = (from: number, count: number, cents: number) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`2026-${String(from + i).padStart(2, "0")}`, cents]),
  );

describe("nextMilestone", () => {
  it("le prochain palier non atteint, daté d'après l'économie mensuelle", () => {
    // 1 000 € de coût, 300 € économisés, 50 €/mois : le quart est passé, la moitié dans 4 mois.
    const m = nextMilestone({
      costEur: 1000,
      cumulativeCents: 30_000,
      monthlyCents: 5_000,
      today: "2026-11-03",
    });
    expect(m?.ratio).toBe(0.5);
    expect(m?.date?.slice(0, 7)).toBe("2027-03");
  });

  it("sans économie mensuelle, le palier n'a pas de date ; amorti : aucun palier", () => {
    expect(
      nextMilestone({ costEur: 1000, cumulativeCents: 0, monthlyCents: 0, today: "2026-11-03" }),
    ).toEqual({
      ratio: 0.25,
      date: null,
    });
    expect(
      nextMilestone({
        costEur: 1000,
        cumulativeCents: 100_000,
        monthlyCents: 5_000,
        today: "2026-11-03",
      }),
    ).toBeNull();
  });
});

describe("recentSavings", () => {
  it("somme des 12 derniers mois complets, avec leurs bornes", () => {
    const r = recentSavings({ ...months(1, 10, 1000) }, "2026-11");
    expect(r).toEqual({ cents: 10_000, months: 10, from: "2026-01", to: "2026-10" });
  });
  it("le mois en cours est exclu ; au plus 12 mois", () => {
    const byMonth = { ...months(1, 12, 1000), "2025-12": 1000, "2025-11": 5000 };
    const r = recentSavings(byMonth, "2026-12");
    expect(r).toEqual({ cents: 12_000, months: 12, from: "2025-12", to: "2026-11" });
    expect(recentSavings({}, "2026-11")).toBeNull();
  });
});

describe("paybackRange", () => {
  // Batterie installée en juin : cinq mois d'été à 21 €, hiver à 40 % de la production de l'été.
  const seasonality = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [i + 1, i + 1 >= 5 && i + 1 <= 9 ? 100 : 40]),
  ) as Record<number, number>;

  it("moins de 12 mois mesurés : date au plus tôt (été toute l'année) et au plus tard (selon le soleil)", () => {
    const r = paybackRange({
      costEur: 1550,
      cumulativeCents: 17_400,
      byMonth: months(6, 5, 2_100),
      seasonality,
      currentMonth: "2026-11",
    });
    expect(r).not.toBeNull();
    expect((r?.early ?? "") < (r?.late ?? "")).toBe(true);
    // Au rythme de l'été (21 €/mois) : (1550 − 174) / 21 ≈ 66 mois.
    expect(r?.early).toBe("2032-04");
  });

  it("12 mois mesurés, déjà amorti, ou sans saisonnalité : pas de fourchette", () => {
    const base = { costEur: 1550, cumulativeCents: 17_400, seasonality, currentMonth: "2026-11" };
    expect(
      paybackRange({
        ...base,
        byMonth: { ...months(1, 10, 2_100), "2025-11": 2_100, "2025-12": 2_100 },
      }),
    ).toBeNull();
    expect(
      paybackRange({ ...base, cumulativeCents: 200_000, byMonth: months(6, 5, 2_100) }),
    ).toBeNull();
    expect(paybackRange({ ...base, seasonality: null, byMonth: months(6, 5, 2_100) })).toBeNull();
  });

  it("une production sans saisonnalité marquée donne la même date : pas de fourchette", () => {
    const flat = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 100])) as Record<
      number,
      number
    >;
    expect(
      paybackRange({
        costEur: 1550,
        cumulativeCents: 17_400,
        byMonth: months(6, 5, 2_100),
        seasonality: flat,
        currentMonth: "2026-11",
      }),
    ).toBeNull();
  });
});
