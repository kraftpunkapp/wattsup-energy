import { describe, expect, it } from "vitest";
import { priceIntervals } from "@/domain/tariff/engine";
import type {
  BaseContract,
  HphcContract,
  PriceableInterval,
  PricingContext,
} from "@/domain/tariff/types";

// Les montants attendus sont calculés à la main (profil constant de 1 kWh/h),
// indépendamment du moteur.

const TZ = "Europe/Paris";
const HOUR = 3_600_000;

/** 1 kWh pour chaque heure UTC de [fromIso, toIso). */
function hourly(fromIso: string, toIso: string, kwh = 1): PriceableInterval[] {
  const out: PriceableInterval[] = [];
  for (let t = Date.parse(fromIso); t < Date.parse(toIso); t += HOUR) {
    out.push({ granularity: "hour", start: new Date(t), kwh });
  }
  return out;
}

const YEAR_2026 = hourly("2025-12-31T23:00:00Z", "2026-12-31T23:00:00Z"); // année locale 2026
const ctx2026: PricingContext = { timezone: TZ, period: { from: "2026-01-01", to: "2027-01-01" } };

const base: BaseContract = { kind: "base", subscriptionEurYear: 229.2, priceEurKwh: 0.2516 };
const hphc = (hcRanges: HphcContract["hcRanges"]): HphcContract => ({
  kind: "hphc",
  subscriptionEurYear: 236.4,
  prices: { hp: 0.27, hc: 0.2068 },
  hcRanges,
});
const night = hphc([{ from: "22:00", to: "06:00" }]);

describe("contrat Base", () => {
  it("année complète : 8 760 kWh × prix + abonnement plein", () => {
    const r = priceIntervals(YEAR_2026, base, ctx2026);
    expect(r.kwh).toBe(8760);
    expect(r.energyCents).toBe(220402); // 8 760 × 0,2516 = 2 204,016 €
    expect(r.subscriptionCents).toBe(22920);
    expect(r.totalCents).toBe(243322);
    expect(r.bySlot).toEqual({ base: { kwh: 8760, energyCents: 220402 } });
    expect(r.approximatedKwh).toBe(0);
  });

  it("ventilation mensuelle : 12 mois, kWh = heures locales du mois", () => {
    const r = priceIntervals(YEAR_2026, base, ctx2026);
    expect(Object.keys(r.byMonth)).toHaveLength(12);
    expect(r.byMonth["2026-01"]?.kwh).toBe(744);
    expect(r.byMonth["2026-03"]?.kwh).toBe(743); // passage à l'heure d'été
    expect(r.byMonth["2026-10"]?.kwh).toBe(745); // passage à l'heure d'hiver
    expect(r.byMonth["2026-02"]?.subscriptionCents).toBe(Math.round((22920 * 28) / 365));
  });

  it("ventilation par jour local : kWh, énergie et abonnement du jour", () => {
    const r = priceIntervals(YEAR_2026, base, ctx2026);
    expect(Object.keys(r.byDay)).toHaveLength(365);
    expect(r.byDay["2026-03-29"]?.kwh).toBe(23); // passage à l'heure d'été
    expect(r.byDay["2026-10-25"]?.kwh).toBe(25);
    expect(r.byDay["2026-02-10"]?.subscriptionCents).toBe(Math.round(22920 / 365));
    const january = Object.entries(r.byDay).filter(([d]) => d.startsWith("2026-01"));
    expect(january.reduce((a, [, d]) => a + d.kwh, 0)).toBe(r.byMonth["2026-01"]?.kwh);
  });

  it("abonnement proratisé au jour sur la période", () => {
    const r = priceIntervals([], base, {
      timezone: TZ,
      period: { from: "2026-02-01", to: "2026-03-01" },
    });
    expect(r.subscriptionCents).toBe(1758); // 229,20 × 28 / 365 = 17,582 €
    expect(r.energyCents).toBe(0);
  });

  it("année bissextile : abonnement divisé par 366", () => {
    const r = priceIntervals([], base, {
      timezone: TZ,
      period: { from: "2024-02-01", to: "2024-03-01" },
    });
    expect(r.subscriptionCents).toBe(Math.round((22920 * 29) / 366));
  });
});

describe("contrat HP/HC", () => {
  it("année complète 22h–6h : 2 920 h creuses, 5 840 h pleines", () => {
    const r = priceIntervals(YEAR_2026, night, ctx2026);
    expect(r.bySlot.hc?.kwh).toBe(2920);
    expect(r.bySlot.hp?.kwh).toBe(5840);
    // 2 920 × 0,2068 + 5 840 × 0,27 = 603,856 + 1 576,80 = 2 180,656 €
    expect(r.energyCents).toBe(218066);
    expect(r.subscriptionCents).toBe(23640);
    expect(r.totalCents).toBe(241706);
    // Créneaux par mois : janvier, 31 jours × 8 h creuses et 16 h pleines.
    expect(r.byMonth["2026-01"]?.slotKwh).toEqual({ hc: 248, hp: 496 });
    const months = Object.values(r.byMonth);
    expect(months.reduce((a, m) => a + (m.slotKwh.hc ?? 0), 0)).toBe(2920);
  });

  it("jour du passage à l'heure d'hiver : 25 h dont 9 creuses", () => {
    // 25 oct. 2026 local = 24 oct. 22:00Z → 25 oct. 23:00Z
    const day = hourly("2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z");
    expect(day).toHaveLength(25);
    const r = priceIntervals(day, night, {
      timezone: TZ,
      period: { from: "2026-10-25", to: "2026-10-25" },
    });
    expect(r.bySlot.hc?.kwh).toBe(9);
    expect(r.bySlot.hp?.kwh).toBe(16);
  });

  it("jour du passage à l'heure d'été : 23 h dont 7 creuses", () => {
    const day = hourly("2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z");
    expect(day).toHaveLength(23);
    const r = priceIntervals(day, night, {
      timezone: TZ,
      period: { from: "2026-03-29", to: "2026-03-29" },
    });
    expect(r.bySlot.hc?.kwh).toBe(7);
  });

  it("plages à la demi-heure (22:30–06:30) : les heures de bord sont partagées", () => {
    const day = hourly("2026-10-01T22:00:00Z", "2026-10-02T22:00:00Z"); // 2 oct. local
    const r = priceIntervals(day, hphc([{ from: "22:30", to: "06:30" }]), {
      timezone: TZ,
      period: { from: "2026-10-02", to: "2026-10-02" },
    });
    expect(r.bySlot.hc?.kwh).toBeCloseTo(8, 10);
    expect(r.bySlot.hp?.kwh).toBeCloseTo(16, 10);
  });

  it("plusieurs plages (02:00–07:00 + 13:00–16:00) : 8 h creuses", () => {
    const day = hourly("2026-10-01T22:00:00Z", "2026-10-02T22:00:00Z");
    const r = priceIntervals(
      day,
      hphc([
        { from: "02:00", to: "07:00" },
        { from: "13:00", to: "16:00" },
      ]),
      { timezone: TZ, period: { from: "2026-10-02", to: "2026-10-02" } },
    );
    expect(r.bySlot.hc?.kwh).toBe(8);
  });

  it("plage se terminant à minuit (20:00–24:00)", () => {
    const day = hourly("2026-10-01T22:00:00Z", "2026-10-02T22:00:00Z");
    const r = priceIntervals(day, hphc([{ from: "20:00", to: "24:00" }]), {
      timezone: TZ,
      period: { from: "2026-10-02", to: "2026-10-02" },
    });
    expect(r.bySlot.hc?.kwh).toBe(4);
  });
});

describe("intervalles journaliers", () => {
  const daily = (slot: "hp" | "hc" | null, kwh: number): PriceableInterval => ({
    granularity: "day",
    date: "2026-10-01",
    slot,
    kwh,
  });
  const oneDay: PricingContext = { timezone: TZ, period: { from: "2026-10-01", to: "2026-10-01" } };

  it("HP/HC déjà ventilés : pris tels quels, sans approximation", () => {
    const r = priceIntervals([daily("hp", 6.82), daily("hc", 5.31)], night, oneDay);
    expect(r.bySlot.hp?.kwh).toBeCloseTo(6.82, 10);
    expect(r.bySlot.hc?.kwh).toBeCloseTo(5.31, 10);
    expect(r.energyCents).toBe(Math.round((6.82 * 0.27 + 5.31 * 0.2068) * 100));
    expect(r.approximatedKwh).toBe(0);
  });

  it("total sans créneau sous un contrat HP/HC : réparti au prorata des heures, signalé", () => {
    const r = priceIntervals([daily(null, 24)], night, oneDay);
    expect(r.bySlot.hc?.kwh).toBeCloseTo(8, 10);
    expect(r.bySlot.hp?.kwh).toBeCloseTo(16, 10);
    expect(r.approximatedKwh).toBe(24);
  });

  it("créneaux HP/HC sous un contrat Base : un seul prix", () => {
    const r = priceIntervals([daily("hp", 6), daily("hc", 4)], base, oneDay);
    expect(r.bySlot).toEqual({ base: { kwh: 10, energyCents: Math.round(10 * 0.2516 * 100) } });
  });
});

describe("validation des plages", () => {
  it("rejette une plage vide (début = fin)", () => {
    expect(() =>
      priceIntervals([], hphc([{ from: "06:00", to: "06:00" }]), {
        timezone: TZ,
        period: { from: "2026-10-01", to: "2026-10-01" },
      }),
    ).toThrow(/plage vide/);
  });
});
