import { describe, expect, it } from "vitest";
import { CONTRACT_PRESETS, parseContractInput } from "@/domain/tariff/schema";

const ok = (input: unknown) => {
  const r = parseContractInput(input);
  if (!r.success) throw new Error(JSON.stringify(r.errors));
  return r.data;
};
const errors = (input: unknown) => {
  const r = parseContractInput(input);
  return r.success ? [] : r.errors;
};

describe("parseContractInput", () => {
  it("accepte un contrat Base", () => {
    expect(
      ok({
        name: "Tarif Base",
        contract: { kind: "base", subscriptionEurYear: 229.2, priceEurKwh: 0.2516 },
      }),
    ).toEqual({
      name: "Tarif Base",
      contract: { kind: "base", subscriptionEurYear: 229.2, priceEurKwh: 0.2516 },
    });
  });

  it("accepte un HP/HC à plusieurs plages, rejette une plage vide ou invalide", () => {
    const hphc = (hcRanges: unknown) => ({
      name: "HP/HC",
      contract: {
        kind: "hphc",
        subscriptionEurYear: 236.4,
        prices: { hp: 0.27, hc: 0.2068 },
        hcRanges,
      },
    });
    expect(
      ok(
        hphc([
          { from: "02:00", to: "07:00" },
          { from: "13:00", to: "16:00" },
        ]),
      ).name,
    ).toBe("HP/HC");
    expect(errors(hphc([]))[0]?.message).toMatch(/au moins une plage/);
    expect(errors(hphc([{ from: "06:00", to: "06:00" }]))[0]?.message).toMatch(/plage vide/);
    expect(errors(hphc([{ from: "25:00", to: "06:00" }]))[0]?.message).toMatch(/heure invalide/);
  });

  it("exige les 6 prix d'un contrat Tempo", () => {
    expect(
      errors({
        name: "Tempo",
        contract: {
          kind: "tempo",
          subscriptionEurYear: 230,
          prices: {
            bleu: { hp: 0.15, hc: 0.12 },
            blanc: { hp: 0.17, hc: 0.14 },
            rouge: { hp: 0.65 },
          },
        },
      }).map((e) => e.path),
    ).toEqual(["contract.prices.rouge.hc"]);
  });

  it("valide la couverture d'un contrat sur mesure", () => {
    const custom = (rules: unknown) => ({
      name: "Zen",
      contract: { kind: "custom", subscriptionEurYear: 0, rules },
    });
    expect(
      errors(
        custom([
          {
            label: "Semaine",
            days: [1, 2, 3, 4, 5],
            ranges: [{ from: "00:00", to: "24:00" }],
            price: 0.25,
          },
        ]),
      )[0]?.message,
    ).toBe("aucune règle ne couvre samedi à 00:00");
  });

  it("refuse un nom vide, un type inconnu, des prix négatifs ou absurdes", () => {
    expect(
      errors({ name: " ", contract: { kind: "base", subscriptionEurYear: 0, priceEurKwh: 0.2 } })[0]
        ?.path,
    ).toBe("name");
    expect(errors({ name: "X", contract: { kind: "solaire" } }).length).toBeGreaterThan(0);
    expect(
      errors({
        name: "X",
        contract: { kind: "base", subscriptionEurYear: -1, priceEurKwh: 0.2 },
      })[0]?.path,
    ).toBe("contract.subscriptionEurYear");
    expect(
      errors({ name: "X", contract: { kind: "base", subscriptionEurYear: 0, priceEurKwh: 25 } })[0]
        ?.path,
    ).toBe("contract.priceEurKwh");
  });

  it("supprime les espaces autour du nom", () => {
    expect(
      ok({
        name: "  Mon contrat ",
        contract: { kind: "base", subscriptionEurYear: 0, priceEurKwh: 0.2 },
      }).name,
    ).toBe("Mon contrat");
  });
});

describe("saisons et début de journée (T56)", () => {
  const rule = (months?: number[]) => ({
    label: "Toute l'année",
    days: [1, 2, 3, 4, 5, 6, 7],
    ranges: [{ from: "00:00", to: "24:00" }],
    price: 0.2,
    ...(months ? { months } : {}),
  });

  it("accepte des mois et une journée qui commence à 6 h", () => {
    const contract = {
      kind: "custom",
      subscriptionEurYear: 100,
      dayStartHour: 6,
      rules: [rule([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])],
    };
    expect(ok({ name: "Saisons", contract }).contract).toEqual(contract);
  });

  it("refuse une heure de début autre que 0 ou 6, et un mois non couvert", () => {
    const base = { kind: "custom", subscriptionEurYear: 100, rules: [rule()] };
    expect(parseContractInput({ name: "X", contract: { ...base, dayStartHour: 5 } }).success).toBe(
      false,
    );
    const r = parseContractInput({ name: "X", contract: { ...base, rules: [rule([1, 2])] } });
    expect(r.success).toBe(false);
  });
});

describe("offres de référence", () => {
  it("chaque offre de référence est un contrat valide", () => {
    expect(CONTRACT_PRESETS.map((p) => p.contract.kind)).toEqual([
      "base",
      "hphc",
      "tempo",
      "custom",
      "custom",
      "custom",
    ]);
    for (const preset of CONTRACT_PRESETS) {
      expect(parseContractInput({ name: preset.name, contract: preset.contract }).success).toBe(
        true,
      );
    }
  });
});
