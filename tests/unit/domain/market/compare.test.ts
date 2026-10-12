import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareMarket, householdOffPeak, parseMeterPower } from "@/domain/market/compare";
import { findCallArguments } from "@/domain/market/literal";
import { parseSourceTariff, type SourceTariff } from "@/domain/market/offer";
import type { Contract, PriceableInterval, PricingContext } from "@/domain/tariff/types";

// Comparaison des offres du marché (SPEC §7.12) sur une même consommation, avec le contrat
// actuel du foyer comme référence. Profil constant de 1 kWh/h sur une semaine.

const ROOT = join(__dirname, "../../../fixtures/market/scripts/tarifs");
function load(path: string): SourceTariff[] {
  return findCallArguments(readFileSync(join(ROOT, path), "utf8"), "defineTarif").map((a) => {
    if (!a.ok) throw new Error(a.error);
    const p = parseSourceTariff(a.value);
    if (!p.ok) throw new Error(p.error);
    return p.tariff;
  });
}
const catalog = [
  "edf/bleu.js",
  "edf/tempo.js",
  "edf/zenEstival.js",
  "edf/ejp.js",
  "total/chargheures.js",
]
  .flatMap(load)
  .map((definition) => ({ name: definition.name, definition }));

const WEEK: PriceableInterval[] = Array.from({ length: 7 * 24 }, (_, h) => ({
  granularity: "hour",
  start: new Date(Date.UTC(2026, 9, 5, h - 2)), // lundi 5 octobre, minuit local
  kwh: 1,
}));
const ctx: PricingContext = {
  timezone: "Europe/Paris",
  period: { from: "2026-10-05", to: "2026-10-12" },
  tempoColor: () => "bleu",
};
const current: Contract = { kind: "base", subscriptionEurYear: 240, priceEurKwh: 0.25 };

describe("puissance du compteur", () => {
  it("n'accepte que les puissances normalisées", () => {
    expect(parseMeterPower(9)).toBe(9);
    expect(parseMeterPower("12")).toBe(12);
    expect(parseMeterPower(7)).toBeNull();
    expect(parseMeterPower(undefined)).toBeNull();
  });
});

describe("plages creuses du foyer", () => {
  it("celles du contrat HP/HC actuel, celles de Tempo, sinon aucune", () => {
    const hc = [{ from: "23:00", to: "07:00" }];
    expect(
      householdOffPeak({
        kind: "hphc",
        subscriptionEurYear: 1,
        prices: { hp: 1, hc: 1 },
        hcRanges: hc,
      }),
    ).toEqual(hc);
    expect(
      householdOffPeak({
        kind: "tempo",
        subscriptionEurYear: 1,
        prices: {
          bleu: { hp: 1, hc: 1 },
          blanc: { hp: 1, hc: 1 },
          rouge: { hp: 1, hc: 1 },
        },
      }),
    ).toEqual([{ from: "22:00", to: "06:00" }]);
    expect(householdOffPeak(current)).toBeNull();
    expect(householdOffPeak(null)).toBeNull();
  });
});

describe("compareMarket", () => {
  const r = compareMarket(catalog, 9, current, WEEK, ctx, 7);

  it("classe les offres comparables, de la moins chère à la plus chère", () => {
    expect(r.rows.map((row) => row.name)).toEqual([
      "EDF - Tempo",
      "EDF - Bleu Heures Creuses",
      "EDF - Bleu",
      "TotalEnergie - Charge'Heures",
    ]);
    const costs = r.rows.map((row) => row.annualCents);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });

  it("écart annuel avec le contrat actuel", () => {
    const bleu = r.rows.find((row) => row.name === "EDF - Bleu");
    // 168 kWh et 7 jours d'abonnement (arrondis chacun au centime), ramenés à l'année.
    const annual = (sub: number, price: number) =>
      Math.round(((Math.round(168 * price * 100) + Math.round(((sub * 7) / 365) * 100)) * 365) / 7);
    expect(bleu?.annualCents).toBe(annual(238.56, 0.1985));
    expect(bleu?.deltaAnnualCents).toBe(annual(238.56, 0.1985) - annual(240, 0.25));
    expect(bleu).toMatchObject({ provider: "EDF", offer: "Bleu", regulated: true, kind: "base" });
  });

  it("heures creuses supposées sans contrat HP/HC", () => {
    expect(r.rows.find((row) => row.name === "EDF - Bleu Heures Creuses")?.assumedOffPeak).toBe(
      true,
    );
    expect(r.rows.find((row) => row.name === "EDF - Tempo")?.assumedOffPeak).toBe(false);
  });

  it("compte les offres pas encore comparables et celles absentes à cette puissance", () => {
    expect(r.pending).toEqual([{ name: "EDF - Zen Estival", reason: "prix selon la saison" }]);
    expect(r.unavailable).toBe(0);
    const small = compareMarket(catalog, 3, current, WEEK, ctx, 7);
    expect(small.rows.map((row) => row.name)).toEqual(["EDF - Bleu"]);
    expect(small.unavailable).toBe(3); // Bleu HC, Tempo, Charge'Heures : pas de 3 kVA
  });

  it("sans contrat actuel : pas d'écart", () => {
    const none = compareMarket(catalog, 9, null, WEEK, ctx, 7);
    expect(none.rows.every((row) => row.deltaAnnualCents === null)).toBe(true);
    expect(none.currentAnnualCents).toBeNull();
  });
});
