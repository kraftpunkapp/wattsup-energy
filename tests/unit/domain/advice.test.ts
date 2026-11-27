import { describe, expect, it } from "vitest";
import { consumptionAdvice, formatHm, surplusWindow } from "@/domain/advice";
import type { HphcContract, TempoContract } from "@/domain/tariff/types";

const profile = (values: Record<number, number>) =>
  Array.from({ length: 24 }, (_, hour) => ({ hour, exportKwh: values[hour] ?? 0 }));

describe("surplusWindow", () => {
  it("plus longue suite d'heures au-dessus du seuil, moyenne comprise", () => {
    expect(surplusWindow(profile({ 9: 0.1, 11: 0.8, 12: 1.2, 13: 1, 14: 0.4, 17: 0.3 }))).toEqual({
      from: 11,
      to: 15,
      kwhPerHour: 0.85,
    });
  });

  it("aucune heure au-dessus du seuil : null", () => {
    expect(surplusWindow(profile({ 12: 0.1 }))).toBeNull();
  });
});

describe("formatHm", () => {
  it("heures pleines en « 22 h », minutes gardées sinon", () => {
    expect(formatHm("22:00")).toBe("22 h");
    expect(formatHm("06:30")).toBe("6 h 30");
  });
});

const hphc: HphcContract = {
  kind: "hphc",
  subscriptionEurYear: 236,
  prices: { hp: 0.27, hc: 0.2068 },
  hcRanges: [
    { from: "22:00", to: "06:00" },
    { from: "12:30", to: "14:30" },
  ],
};
const tempo: TempoContract = {
  kind: "tempo",
  subscriptionEurYear: 230,
  prices: {
    bleu: { hp: 0.1612, hc: 0.1325 },
    blanc: { hp: 0.1871, hc: 0.1499 },
    rouge: { hp: 0.706, hc: 0.1575 },
  },
};

describe("consumptionAdvice", () => {
  it("surplus solaire puis heures creuses d'un contrat HP/HC", () => {
    const advice = consumptionAdvice({
      date: "2026-10-07",
      surplus: { from: 11, to: 15, kwhPerHour: 0.85 },
      contract: hphc,
      tomorrow: null,
    });
    expect(advice.map((a) => [a.id, a.title])).toEqual([
      ["surplus", "Entre 11 h et 15 h : votre surplus solaire"],
      ["off_peak", "Heures creuses : 22 h – 6 h et 12 h 30 – 14 h 30"],
    ]);
    expect(advice[1]?.text).toContain("0,207 € au lieu de 0,270 €");
  });

  it("Tempo : demain rouge en premier, avec son prix", () => {
    const advice = consumptionAdvice({
      date: "2026-10-07",
      surplus: null,
      contract: tempo,
      tomorrow: { color: "rouge" },
    });
    expect(advice[0]).toMatchObject({
      id: "tempo_tomorrow",
      tone: "warning",
      title: "Demain, jour rouge",
    });
    expect(advice[0]?.text).toContain("0,706 €");
    expect(advice[1]?.title).toBe("Heures creuses : 22 h – 6 h, tous les jours");
  });

  it("Tempo : couleur de demain pas encore connue ; jour bleu", () => {
    expect(
      consumptionAdvice({
        date: "2026-10-07",
        surplus: null,
        contract: tempo,
        tomorrow: { color: null },
      })[0]?.title,
    ).toBe("Couleur de demain pas encore publiée");
    expect(
      consumptionAdvice({
        date: "2026-10-07",
        surplus: null,
        contract: tempo,
        tomorrow: { color: "bleu" },
      })[0],
    ).toMatchObject({ tone: "positive", title: "Demain, jour bleu" });
    expect(
      consumptionAdvice({
        date: "2026-10-07",
        surplus: null,
        contract: tempo,
        tomorrow: { color: "blanc" },
      })[0]?.text,
    ).toBe("Heures pleines à 0,187 € le kWh, un peu plus qu'un jour bleu (0,161 €).");
  });

  it("contrat Base sans surplus : aucun conseil", () => {
    expect(
      consumptionAdvice({
        date: "2026-10-07",
        surplus: null,
        contract: { kind: "base", subscriptionEurYear: 200, priceEurKwh: 0.25 },
        tomorrow: null,
      }),
    ).toEqual([]);
  });
});

describe("heures creuses d'été (T81)", () => {
  const seasonal: HphcContract = {
    ...hphc,
    hcRanges: [{ from: "23:00", to: "07:00" }],
    summerHcRanges: [
      { from: "02:00", to: "07:00" },
      { from: "12:00", to: "15:00" },
    ],
  };
  const title = (date: string) =>
    consumptionAdvice({ date, surplus: null, contract: seasonal, tomorrow: null })[0]?.title;

  it("les plages annoncées sont celles de la saison du jour", () => {
    expect(title("2027-06-01")).toBe("Heures creuses : 2 h – 7 h et 12 h – 15 h");
    expect(title("2027-01-15")).toBe("Heures creuses : 23 h – 7 h");
  });
});
