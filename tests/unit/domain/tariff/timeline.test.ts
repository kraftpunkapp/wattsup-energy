import { describe, expect, it } from "vitest";
import { priceIntervals } from "@/domain/tariff/engine";
import {
  buildTimeline,
  currentContract,
  findOverlaps,
  gridAt,
  lapsedContract,
  periodAt,
  priceTimeline,
  type DatedContract,
} from "@/domain/tariff/timeline";
import type { BaseContract, PriceableInterval } from "@/domain/tariff/types";

const TZ = "Europe/Paris";
const base = (price: number, subscription = 200): BaseContract => ({
  kind: "base",
  subscriptionEurYear: subscription,
  priceEurKwh: price,
});

// Contrat A souscrit en 2025 avec une hausse au 1er août ; contrat B depuis 2026.
const A: DatedContract = {
  id: "A",
  name: "Ancien",
  status: "subscribed",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  periods: [
    { validFrom: "2025-01-01", contract: base(0.2) },
    { validFrom: "2025-08-01", contract: base(0.25) },
  ],
};
const B: DatedContract = {
  id: "B",
  name: "Nouveau",
  status: "subscribed",
  startDate: "2026-01-01",
  endDate: null,
  periods: [{ validFrom: "2026-01-01", contract: base(0.3, 240) }],
};
const S: DatedContract = {
  id: "S",
  name: "Offre",
  status: "simulated",
  startDate: null,
  endDate: null,
  periods: [{ validFrom: "2026-01-01", contract: base(0.1) }],
};

describe("gridAt", () => {
  it("grille la plus récente dont la date d'effet est passée ; avant la première, la première", () => {
    expect(gridAt(A, "2025-07-31")).toEqual(base(0.2));
    expect(gridAt(A, "2025-08-01")).toEqual(base(0.25));
    expect(gridAt(A, "2024-06-01")).toEqual(base(0.2));
  });
});

describe("periodAt", () => {
  it("rend la période elle-même (date d'effet comprise)", () => {
    expect(periodAt(A, "2025-09-15").validFrom).toBe("2025-08-01");
    expect(periodAt(A, "2024-06-01").validFrom).toBe("2025-01-01");
  });
});

describe("lapsedContract", () => {
  it("dernier contrat souscrit terminé sans successeur, et aucun contrat en cours", () => {
    expect(lapsedContract([A, S], "2026-10-03")?.id).toBe("A");
    expect(lapsedContract([A, B, S], "2026-10-03")).toBeNull(); // B en cours
    expect(lapsedContract([A, { ...B, startDate: "2027-01-01" }], "2026-10-03")).toBeNull(); // B à venir
    expect(lapsedContract([A], "2025-05-01")).toBeNull(); // A en cours
    expect(lapsedContract([S], "2026-10-03")).toBeNull();
  });
});

describe("currentContract", () => {
  it("contrat souscrit dont la période contient le jour", () => {
    expect(currentContract([A, B, S], "2026-10-03")?.id).toBe("B");
    expect(currentContract([A, B, S], "2025-05-01")?.id).toBe("A");
    expect(currentContract([A, S], "2026-10-03")).toBeNull(); // A terminé
    expect(currentContract([{ ...B, startDate: "2027-01-01" }], "2026-10-03")).toBeNull(); // futur
  });
});

describe("findOverlaps", () => {
  it("refuse deux contrats souscrits qui se chevauchent, accepte des périodes accolées", () => {
    expect(findOverlaps([A, B, S], "B")).toEqual([]);
    expect(findOverlaps([A, { ...B, startDate: "2025-12-31" }], "B")).toEqual([
      "Ce contrat (depuis le 31/12/2025) recouvre « Ancien » (du 01/01/2025 au 31/12/2025)",
    ]);
    expect(findOverlaps([A, { ...B, startDate: "2025-06-01" }], "A")).toEqual([
      "Ce contrat (du 01/01/2025 au 31/12/2025) recouvre « Nouveau » (depuis le 01/06/2025)",
    ]);
  });

  it("détecte un chevauchement entre contrats non voisins dans l'ordre des dates", () => {
    // Saisi 2014 au lieu de 2024 : englobe un contrat de 2023 et touche celui de 2025.
    const typo = { ...A, id: "T", name: "Typo", startDate: "2014-01-01", endDate: "2025-03-31" };
    const y2023 = { ...A, id: "Y", name: "2023", startDate: "2023-01-01", endDate: "2023-12-31" };
    expect(findOverlaps([typo, y2023, A, B], "T")).toEqual([
      "Ce contrat (du 01/01/2014 au 31/03/2025) recouvre « 2023 » (du 01/01/2023 au 31/12/2023)",
      "Ce contrat (du 01/01/2014 au 31/03/2025) recouvre « Ancien » (du 01/01/2025 au 31/12/2025)",
    ]);
  });

  it("ignore les chevauchements qui ne concernent pas le contrat enregistré", () => {
    expect(findOverlaps([A, { ...B, startDate: "2025-06-01" }, S], "S")).toEqual([]);
  });

  it("refuse une fin avant le début", () => {
    expect(findOverlaps([{ ...A, endDate: "2024-12-31" }], "A")).toEqual([
      "« Ancien » : la fin (31/12/2024) précède le début (01/01/2025)",
    ]);
  });
});

describe("buildTimeline", () => {
  it("découpe aux changements de contrat et de grille", () => {
    expect(buildTimeline([A, B, S], "2025-06-01", "2026-03-01")).toEqual([
      { from: "2025-06-01", to: "2025-08-01", contractId: "A", contract: base(0.2) },
      { from: "2025-08-01", to: "2026-01-01", contractId: "A", contract: base(0.25) },
      { from: "2026-01-01", to: "2026-03-01", contractId: "B", contract: base(0.3, 240) },
    ]);
  });

  it("jours sans contrat souscrit : grille actuelle du contrat actuel, contractId null", () => {
    const segments = buildTimeline([B], "2025-12-01", "2026-02-01", "2026-10-03");
    expect(segments).toEqual([
      { from: "2025-12-01", to: "2026-01-01", contractId: null, contract: base(0.3, 240) },
      { from: "2026-01-01", to: "2026-02-01", contractId: "B", contract: base(0.3, 240) },
    ]);
  });

  it("aucun contrat souscrit : un segment sans grille", () => {
    expect(buildTimeline([S], "2026-01-01", "2026-02-01")).toEqual([
      { from: "2026-01-01", to: "2026-02-01", contractId: null, contract: null },
    ]);
  });
});

describe("priceTimeline", () => {
  // 1 kWh par heure du 1er juillet au 1er septembre 2025 (heure de Paris)
  const hours: PriceableInterval[] = [];
  for (
    let t = Date.parse("2025-06-30T22:00:00Z");
    t < Date.parse("2025-08-31T22:00:00Z");
    t += 3_600_000
  ) {
    hours.push({ granularity: "hour", start: new Date(t), kwh: 1 });
  }

  it("chaque segment est valorisé avec sa grille, abonnement compris", () => {
    const segments = buildTimeline([A], "2025-07-01", "2025-09-01");
    const r = priceTimeline(hours, segments, { timezone: TZ });
    const july = priceIntervals(hours.slice(0, 31 * 24), base(0.2), {
      timezone: TZ,
      period: { from: "2025-07-01", to: "2025-08-01" },
    });
    const august = priceIntervals(hours.slice(31 * 24), base(0.25), {
      timezone: TZ,
      period: { from: "2025-08-01", to: "2025-09-01" },
    });
    expect(r.totalCents).toBe(july.totalCents + august.totalCents);
    expect(r.byMonth["2025-07"]?.energyCents).toBe(july.energyCents);
    expect(r.byMonth["2025-08"]?.energyCents).toBe(august.energyCents);
    expect(r.byMonth["2025-08"]?.slotKwh).toEqual(august.byMonth["2025-08"]?.slotKwh);
    expect(r.byDay["2025-07-31"]).toEqual(july.byDay["2025-07-31"]);
    expect(r.byDay["2025-08-01"]).toEqual(august.byDay["2025-08-01"]);
    expect(r.kwh).toBe(hours.length);
    expect(r.unknownContractDays).toBe(0);
  });

  it("jours sans contrat comptés ; sans aucune grille, l'énergie n'est pas valorisée", () => {
    const fallback = priceTimeline(
      hours,
      buildTimeline([B], "2025-07-01", "2025-09-01", "2026-10-03"),
      {
        timezone: TZ,
      },
    );
    expect(fallback.unknownContractDays).toBe(62);
    expect(fallback.totalCents).toBeGreaterThan(0);

    const none = priceTimeline(hours, buildTimeline([S], "2025-07-01", "2025-09-01"), {
      timezone: TZ,
    });
    expect(none.totalCents).toBe(0);
    expect(none.unpricedKwh).toBe(hours.length);
  });
});
