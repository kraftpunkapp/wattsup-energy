import { describe, expect, it } from "vitest";
import { hourlyKwhPrices } from "@/domain/tariff/engine";
import type { HphcContract, TempoContract } from "@/domain/tariff/types";

// Prix du kWh heure par heure (T70, SPEC §7.14) : la même grille que la facture, pour le
// coût d'un kWh de plus à chaque heure de demain. Novembre, UTC+1.

const TZ = "Europe/Paris";
const hourAt = (date: string, localHour: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (localHour - 1) * 3_600_000);

const hphc: HphcContract = {
  kind: "hphc",
  subscriptionEurYear: 236.4,
  prices: { hp: 0.27, hc: 0.2068 },
  hcRanges: [{ from: "22:00", to: "06:00" }],
};
const tempo: TempoContract = {
  kind: "tempo",
  subscriptionEurYear: 230.04,
  prices: {
    bleu: { hc: 0.1288, hp: 0.1552 },
    blanc: { hc: 0.1447, hp: 0.1792 },
    rouge: { hc: 0.1518, hp: 0.6586 },
  },
};

describe("hourlyKwhPrices", () => {
  it("heures pleines et creuses du contrat", () => {
    const starts = [hourAt("2026-11-22", 3), hourAt("2026-11-22", 12), hourAt("2026-11-22", 22)];
    const r = hourlyKwhPrices(starts, hphc, {
      timezone: TZ,
      period: { from: "2026-11-22", to: "2026-11-23" },
    });
    expect(r.prices).toEqual([0.2068, 0.27, 0.2068]);
  });

  it("Tempo : couleur du jour Tempo (6 h → 6 h) ; inconnue → bleu, comptée", () => {
    const starts = [hourAt("2026-11-22", 12), hourAt("2026-11-23", 3), hourAt("2026-11-23", 12)];
    const r = hourlyKwhPrices(starts, tempo, {
      timezone: TZ,
      period: { from: "2026-11-22", to: "2026-11-24" },
      tempoColor: (d) => (d === "2026-11-22" ? "rouge" : undefined),
    });
    // 22 à midi : rouge HP ; 23 à 3 h : encore le jour Tempo du 22, rouge HC ; 23 à midi : bleu.
    expect(r.prices).toEqual([0.6586, 0.1518, 0.1552]);
    expect(r.assumedTempoDays).toBe(1);
  });
});

describe("hourlyKwhPrices et saisons (T81)", () => {
  it("une fenêtre à cheval sur le 1er avril prend les plages de chaque jour", () => {
    const seasonal = {
      kind: "hphc" as const,
      subscriptionEurYear: 236,
      prices: { hp: 0.27, hc: 0.2 },
      hcRanges: [{ from: "23:00", to: "07:00" }],
      summerHcRanges: [{ from: "12:00", to: "15:00" }],
    };
    // 13 h locales (UTC+2) le 31 mars puis le 1er avril 2027.
    const r = hourlyKwhPrices(
      [new Date("2027-03-31T11:00:00Z"), new Date("2027-04-01T11:00:00Z")],
      seasonal,
      { timezone: "Europe/Paris", period: { from: "2027-03-31", to: "2027-04-02" } },
    );
    expect(r.prices).toEqual([0.27, 0.2]);
  });
});
