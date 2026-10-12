import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findCallArguments } from "@/domain/market/literal";
import {
  describeOffer,
  diffCatalogs,
  fingerprint,
  isNewOffer,
  isOldGrid,
  parseManifest,
  parseSobrietyCalendar,
  parseSourceTariff,
  splitName,
  toContract,
  type SourceTariff,
} from "@/domain/market/offer";
import { priceIntervals } from "@/domain/tariff/engine";
import type { CustomContract, PriceableInterval } from "@/domain/tariff/types";

// Fichiers réels de la source (tests/fixtures/market, GPL-3.0) : lecture, puis conversion
// vers les contrats du moteur (SPEC §7.12). Montants attendus recalculés à la main depuis
// les grilles publiées (abonnement €/mois × 12, centimes → €).

const ROOT = join(__dirname, "../../../fixtures/market");

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesIn(p) : [p];
  });
}

const tariffs = new Map<string, SourceTariff>();
for (const file of filesIn(join(ROOT, "scripts/tarifs"))) {
  for (const arg of findCallArguments(readFileSync(file, "utf8"), "defineTarif")) {
    if (!arg.ok) throw new Error(`${file} : ${arg.error}`);
    const parsed = parseSourceTariff(arg.value);
    if (!parsed.ok) throw new Error(`${file} : ${parsed.error}`);
    tariffs.set(parsed.tariff.name, parsed.tariff);
  }
}
const get = (name: string) => {
  const t = tariffs.get(name);
  if (!t) throw new Error(`offre absente des fixtures : ${name}`);
  return t;
};
const HOUSE_HC = [{ from: "23:00", to: "07:00" }];

describe("manifeste", () => {
  it("liste les fichiers de tarifs, au format de chemin contrôlé", () => {
    const paths = parseManifest(readFileSync(join(ROOT, "scripts/tarifs-manifest.js"), "utf8"));
    expect(paths.length).toBeGreaterThan(40);
    expect(paths).toContain("scripts/tarifs/edf/tempo.js");
    expect(paths.every((p) => /^scripts\/tarifs\/[^/]+\/[^/]+\.js$/.test(p))).toBe(true);
    expect(paths.some((p) => p.includes("tarifs-lib"))).toBe(false);
  });

  it("écarte un chemin hors du dossier des tarifs", () => {
    const src = `export const TARIF_SCRIPTS = ["scripts/tarifs/a/b.js", "../secret.js", "scripts/tarifs/../x.js"];`;
    expect(parseManifest(src)).toEqual(["scripts/tarifs/a/b.js"]);
  });
});

describe("définition", () => {
  it("refuse une définition sans grille", () => {
    expect(parseSourceTariff({ name: "X - Y", offer_type: "Marché" })).toMatchObject({ ok: false });
    expect(parseSourceTariff("texte")).toMatchObject({ ok: false });
  });

  it("sépare fournisseur et offre", () => {
    expect(splitName("Mint Energie - Online & Green")).toEqual({
      provider: "Mint Energie",
      offer: "Online & Green",
    });
    expect(splitName("Seul")).toEqual({ provider: "Seul", offer: "Seul" });
  });
});

describe("conversion", () => {
  it("EDF Bleu : prix unique, prix du kWh propre aux petites puissances", () => {
    const t = get("EDF - Bleu");
    expect(describeOffer(t)).toMatchObject({
      provider: "EDF",
      offer: "Bleu",
      regulated: true,
      gridDate: "2026-08-01",
      powers: [3, 6, 9, 12, 15, 18, 24, 30, 36],
      support: { status: "compared", kind: "base", householdOffPeak: false, chosenDay: false },
    });
    expect(toContract(t, 9, null)?.contract).toEqual({
      kind: "base",
      subscriptionEurYear: 238.56,
      priceEurKwh: 0.1985,
    });
    expect(toContract(t, 6, null)?.contract).toMatchObject({ priceEurKwh: 0.2001 });
    expect(toContract(t, 7, null)).toBeNull();
  });

  it("EDF Bleu HC : plages creuses du foyer, sinon 22 h – 6 h supposées", () => {
    const t = get("EDF - Bleu Heures Creuses");
    expect(describeOffer(t).support).toEqual({
      status: "compared",
      kind: "hphc",
      householdOffPeak: true,
      chosenDay: false,
    });
    expect(toContract(t, 9, HOUSE_HC)).toEqual({
      contract: {
        kind: "hphc",
        subscriptionEurYear: 238.56,
        prices: { hp: 0.2142, hc: 0.1589 },
        hcRanges: HOUSE_HC,
      },
      householdOffPeak: true,
      assumedOffPeak: false,
    });
    expect(toContract(t, 9, null)).toMatchObject({
      contract: { hcRanges: [{ from: "22:00", to: "06:00" }] },
      assumedOffPeak: true,
    });
    expect(toContract(t, 3, HOUSE_HC)).toBeNull();
  });

  it("HP égal à HC : prix unique, sans plages", () => {
    const t = {
      ...get("EDF - Bleu Heures Creuses"),
      dayTypes: { bleu: { HP: 19.7695, HC: 19.7695 } },
    };
    expect(describeOffer(t).support).toMatchObject({ kind: "base", householdOffPeak: false });
    expect(toContract(t, 9, null)?.contract).toMatchObject({ priceEurKwh: 0.197695 });
  });

  it("EDF Tempo : six prix, heures creuses de Tempo", () => {
    expect(toContract(get("EDF - Tempo"), 9, HOUSE_HC)?.contract).toEqual({
      kind: "tempo",
      subscriptionEurYear: 236.4,
      prices: {
        bleu: { hp: 0.1654, hc: 0.1356 },
        blanc: { hp: 0.1921, hc: 0.1536 },
        rouge: { hp: 0.7295, hc: 0.1615 },
      },
    });
  });

  it("Zen Week-End : un prix la semaine, un le week-end", () => {
    expect(toContract(get("EDF - Zen Week-End"), 9, null)?.contract).toEqual({
      kind: "custom",
      subscriptionEurYear: 238.56,
      rules: [
        { label: "Week-end", days: [6, 7], ranges: [{ from: "00:00", to: "24:00" }], price: 0.171 },
        {
          label: "Semaine",
          days: [1, 2, 3, 4, 5],
          ranges: [{ from: "00:00", to: "24:00" }],
          price: 0.2285,
        },
      ],
    });
  });

  it("Zen Week-End HC : week-end au prix HC, heures creuses du foyer en semaine", () => {
    const c = toContract(get("EDF - Zen Week-End HC"), 9, HOUSE_HC);
    expect(c?.householdOffPeak).toBe(true);
    expect((c?.contract as CustomContract).rules).toEqual([
      { label: "Week-end", days: [6, 7], ranges: [{ from: "00:00", to: "24:00" }], price: 0.1762 },
      { label: "Semaine HC", days: [1, 2, 3, 4, 5], ranges: HOUSE_HC, price: 0.1762 },
      {
        label: "Semaine HP",
        days: [1, 2, 3, 4, 5],
        ranges: [{ from: "00:00", to: "24:00" }],
        price: 0.2359,
      },
    ]);
  });

  it("Charge'Heures : heures super creuses prioritaires sur les heures creuses", () => {
    const t = get("TotalEnergie - Charge'Heures");
    expect(describeOffer(t).powers).toContain(7);
    const c = toContract(t, 9, null);
    expect(c?.householdOffPeak).toBe(false);
    expect((c?.contract as CustomContract).rules.map((r) => [r.label, r.price])).toEqual([
      ["Heures super creuses", 0.1335],
      ["Heures creuses", 0.1576],
      ["Heures pleines", 0.2302],
    ]);
    // 1 kWh chaque heure d'une journée d'octobre (UTC+2) : 4 h super creuses (2 h – 6 h),
    // 4 h creuses (23 h – 2 h et 6 h – 7 h), 16 h pleines.
    const day: PriceableInterval[] = Array.from({ length: 24 }, (_, h) => ({
      granularity: "hour",
      start: new Date(Date.UTC(2026, 9, 11, h - 2)),
      kwh: 1,
    }));
    const r = priceIntervals(day, (c as NonNullable<typeof c>).contract, {
      timezone: "Europe/Paris",
      period: { from: "2026-10-11", to: "2026-10-12" },
    });
    expect(r.energyCents).toBe(Math.round((4 * 0.1335 + 4 * 0.1576 + 16 * 0.2302) * 100));
  });

  it.each([
    ["EDF - EJP", { status: "never", reason: "closed" }],
    ["Sobry - SoCap", { status: "pending", reason: "spot" }],
  ])("%s : pas encore comparée, avec sa raison", (name, support) => {
    expect(describeOffer(get(name)).support).toEqual(support);
    expect(toContract(get(name), 9, null)).toBeNull();
  });

  it("Zen Estival : saisons, heures super creuses prioritaires, journée de 6 h à 6 h", () => {
    const t = get("EDF - Zen Estival");
    expect(describeOffer(t).support).toMatchObject({ status: "compared", kind: "custom" });
    const c = toContract(t, 9, null)?.contract as CustomContract;
    expect(c.dayStartHour).toBe(6);
    const WINTER = [11, 12, 1, 2, 3];
    const SUMMER = [4, 5, 6, 7, 8, 9, 10];
    expect(c.rules.map((r) => [r.label, r.price, r.months])).toEqual([
      ["Hiver heures super creuses", 0.1992, WINTER],
      ["Hiver HC", 0.2131, WINTER],
      ["Hiver HP", 0.2722, WINTER],
      ["Été heures super creuses", 0.0991, SUMMER],
      ["Été HC", 0.1405, SUMMER],
      ["Été HP", 0.1588, SUMMER],
    ]);
    // Plage d'été « 22:00 → 00:00 » jamais atteinte chez la source : ignorée.
    expect(c.rules[4]?.ranges).toEqual([{ from: "00:00", to: "07:00" }]);
  });

  it("Enercoop 2 saisons : week-end entier en heures creuses, semaine selon la saison", () => {
    const c = toContract(get("Enercoop - Offre Flexibilité 2 Saisons"), 9, null)
      ?.contract as CustomContract;
    expect(c.dayStartHour).toBe(6);
    expect(c.rules.map((r) => [r.label, r.days, r.price])).toEqual([
      ["Hiver week-end", [6, 7], 0.22356],
      ["Hiver HC", [1, 2, 3, 4, 5], 0.22356],
      ["Hiver HP", [1, 2, 3, 4, 5], 0.31601],
      ["Été week-end", [6, 7], 0.13831],
      ["Été HC", [1, 2, 3, 4, 5], 0.13831],
      ["Été HP", [1, 2, 3, 4, 5], 0.19567],
    ]);
  });

  it("Zen Week-End Option Flex : prix propres aux jours de sobriété", () => {
    const t = get("EDF - Zen Week-End Option Flex");
    expect(describeOffer(t).support).toMatchObject({ status: "compared", kind: "custom" });
    const c = toContract(t, 9, null)?.contract as CustomContract;
    expect(c.rules.map((r) => [r.label, r.price, r.onlySobrietyDays ?? false])).toEqual([
      ["Jours de sobriété HC", 0.2142, true],
      ["Jours de sobriété HP", 0.7467, true],
      ["Heures creuses", 0.1595, false],
      ["Heures pleines", 0.2142, false],
    ]);
  });

  it("calendrier Zen Flex de la source : dates ISO, croissantes", () => {
    const days = parseSobrietyCalendar(
      readFileSync(join(ROOT, "scripts/tarifs-lib/calendars/zenflex-sobriete.js"), "utf8"),
    );
    expect(days.length).toBeGreaterThan(100);
    expect(days).toContain("2026-03-26");
    expect([...days].sort()).toEqual(days);
    expect(() => parseSobrietyCalendar(`defineCalendar("tempo-edf", {})`)).toThrow(/introuvable/);
    expect(() =>
      parseSobrietyCalendar(`defineCalendar("zenflex-sobriete", { sobriete: { days: ["hier"] } })`),
    ).toThrow(/date invalide/);
  });

  it("Zen Week-End Plus : le jour choisi s'ajoute au week-end", () => {
    const t = get("EDF - Zen Week-End Plus");
    expect(describeOffer(t).support).toMatchObject({ status: "compared", chosenDay: true });
    expect(toContract(t, 9, null)).toBeNull(); // jour requis
    expect(toContract(t, 9, null, 6)).toBeNull(); // samedi : déjà du week-end
    const c = toContract(t, 9, null, 3)?.contract as CustomContract;
    expect(c.rules.map((r) => [r.label, r.days])).toEqual([
      ["Week-end et mercredi", [3, 6, 7]],
      ["Semaine", [1, 2, 4, 5]],
    ]);
  });

  it("toutes les offres des fixtures se lisent ; les comparées passent la validation", () => {
    for (const t of tariffs.values()) {
      const info = describeOffer(t);
      if (info.support.status !== "compared") continue;
      const day = info.support.chosenDay ? 1 : undefined;
      for (const kva of info.powers) expect(toContract(t, kva, HOUSE_HC, day)).not.toBeNull();
    }
    const compared = [...tariffs.values()].filter(
      (t) => describeOffer(t).support.status === "compared",
    );
    expect(compared.length).toBeGreaterThanOrEqual(10);
  });

  it("une règle inconnue est signalée, sans erreur", () => {
    const t = { ...get("EDF - Bleu"), dayRule: { type: "lunaire" } };
    expect(describeOffer(t).support).toEqual({ status: "pending", reason: "unknown" });
    const season = {
      ...get("EDF - Zen Estival"),
      dayRule: { type: "season", seasons: {}, previousDayBefore: 5 },
    };
    expect(describeOffer(season).support).toEqual({ status: "pending", reason: "unknown" });
  });
});

describe("suivi des changements", () => {
  it("empreinte indépendante de l'ordre des clés", () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: [1, { e: 1, f: 2 }] } })).toBe(
      fingerprint({ b: { d: [1, { f: 2, e: 1 }], c: 2 }, a: 1 }),
    );
  });

  it("nouvelles, retirées et modifiées", () => {
    const before = [
      { name: "A", definition: { p: 1 } },
      { name: "B", definition: { p: 1 } },
      { name: "C", definition: { p: 1 } },
    ];
    const after = [
      { name: "A", definition: { p: 1 } },
      { name: "C", definition: { p: 2 } },
      { name: "D", definition: { p: 1 } },
    ];
    expect(diffCatalogs(before, after)).toEqual({ added: ["D"], removed: ["B"], updated: ["C"] });
  });
});

describe("fraîcheur", () => {
  it("grille ancienne au-delà de 6 mois", () => {
    expect(isOldGrid("2026-04-12", "2026-10-12")).toBe(false);
    expect(isOldGrid("2026-04-11", "2026-10-12")).toBe(true);
    expect(isOldGrid("2025-12-31", "2026-03-15")).toBe(false);
  });

  it("offre nouvelle pendant 30 jours, sauf celles du premier import", () => {
    const start = new Date("2026-10-01T02:00:00Z");
    const now = new Date("2026-10-20T02:00:00Z");
    expect(isNewOffer(start, start, now)).toBe(false);
    expect(isNewOffer(new Date("2026-10-10T02:00:00Z"), start, now)).toBe(true);
    expect(
      isNewOffer(new Date("2026-10-10T02:00:00Z"), start, new Date("2026-11-10T02:00:00Z")),
    ).toBe(false);
  });
});
