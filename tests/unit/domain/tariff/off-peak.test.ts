import { describe, expect, it } from "vitest";
import { compareContracts } from "@/domain/tariff/compare";
import { priceIntervals } from "@/domain/tariff/engine";
import { needsOffPeakCheck, offPeakRangesAt } from "@/domain/tariff/off-peak";
import { CONTRACT_PRESETS, parseContractInput } from "@/domain/tariff/schema";
import type { HphcContract, PriceableInterval, PricingContext } from "@/domain/tariff/types";

const preset = (kind: string) =>
  CONTRACT_PRESETS.find((p) => p.contract.kind === kind)?.contract ?? null;

describe("needsOffPeakCheck", () => {
  it("seulement pour un contrat HP/HC", () => {
    expect(needsOffPeakCheck(preset("hphc"))).toBe(true);
    expect(needsOffPeakCheck(preset("base"))).toBe(false);
    expect(needsOffPeakCheck(preset("tempo"))).toBe(false);
    expect(needsOffPeakCheck(null)).toBe(false);
  });
});

const W = [{ from: "23:00", to: "07:00" }];
const S = [
  { from: "02:00", to: "07:00" },
  { from: "12:00", to: "15:00" },
];
const hphc = (summerHcRanges?: HphcContract["hcRanges"]): HphcContract => ({
  kind: "hphc",
  subscriptionEurYear: 236,
  prices: { hp: 0.27, hc: 0.2 },
  hcRanges: W,
  ...(summerHcRanges ? { summerHcRanges } : {}),
});
const ctx: PricingContext = {
  timezone: "Europe/Paris",
  period: { from: "2027-03-31", to: "2027-04-02" },
};
const at = (iso: string): PriceableInterval => ({
  granularity: "hour",
  start: new Date(iso),
  kwh: 1,
});
const day = (date: string): PriceableInterval => ({
  granularity: "day",
  date,
  slot: null,
  kwh: 24,
});

describe("heures creuses d'été", () => {
  it("été du 1er avril au 31 octobre, hiver du 1er novembre au 31 mars", () => {
    const hours = { hcRanges: W, summerHcRanges: S };
    expect(offPeakRangesAt(hours, "2027-03-31")).toEqual(W);
    expect(offPeakRangesAt(hours, "2027-04-01")).toEqual(S);
    expect(offPeakRangesAt(hours, "2027-10-31")).toEqual(S);
    expect(offPeakRangesAt(hours, "2027-11-01")).toEqual(W);
    expect(offPeakRangesAt({ hcRanges: W }, "2027-07-01")).toEqual(W);
  });

  it("coût horaire : 13 h en pleines l'hiver, en creuses l'été (heure de Paris)", () => {
    const hiver = priceIntervals([at("2027-03-31T11:00:00Z")], hphc(S), ctx);
    const ete = priceIntervals([at("2027-04-01T11:00:00Z")], hphc(S), ctx);
    expect(Object.keys(hiver.bySlot)).toEqual(["hp"]);
    expect(Object.keys(ete.bySlot)).toEqual(["hc"]);
  });

  it("total journalier sans créneau : part creuse de la saison, comptée comme supposée", () => {
    const midi = hphc([{ from: "12:00", to: "15:00" }]);
    const hiver = priceIntervals([day("2027-03-31")], midi, ctx);
    const ete = priceIntervals([day("2027-04-01")], midi, ctx);
    expect(hiver.bySlot.hc?.kwh).toBeCloseTo(8);
    expect(ete.bySlot.hc?.kwh).toBeCloseTo(3);
    expect(ete.approximatedKwh).toBe(24);
    expect(priceIntervals([day("2027-04-01")], hphc(S), ctx).bySlot.hc?.kwh).toBeCloseTo(8);
  });

  it("saisie : plages d'été conservées ; liste vide ou plage vide refusées", () => {
    const parse = (summerHcRanges: unknown) =>
      parseContractInput({ name: "HC", contract: { ...hphc(), summerHcRanges } });
    const ok = parse(S);
    expect(ok.success && ok.data.contract).toMatchObject({ summerHcRanges: S });
    const empty = parse([]);
    expect(empty.success ? [] : empty.errors.map((e) => e.message)).toContain(
      "au moins une plage d'heures creuses en été",
    );
    expect(parse([{ from: "12:00", to: "12:00" }]).success).toBe(false);
  });

  it("comparaison en envoi quotidien : un été différent rend le coût approximatif", () => {
    const intervals: PriceableInterval[] = [
      { granularity: "day", date: "2027-04-01", slot: "hp", kwh: 5 },
    ];
    const approximate = (other: HphcContract) =>
      compareContracts(
        [
          { id: "a", name: "a", isCurrent: true, contract: hphc() },
          { id: "b", name: "b", isCurrent: false, contract: other },
        ],
        intervals,
        ctx,
        1,
      ).find((r) => r.id === "b")?.approximate;
    expect(approximate(hphc(S))).toBe(true);
    expect(approximate(hphc(W))).toBe(false);
  });

  it("plus rien à vérifier une fois les plages d'été saisies", () => {
    expect(needsOffPeakCheck(hphc(S))).toBe(false);
  });
});
