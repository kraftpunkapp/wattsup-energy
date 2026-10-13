import { describe, expect, it } from "vitest";
import {
  coverageWindow,
  energyBalance,
  expectedSlots,
  parsePeriod,
  peakSplit,
  slotHpHc,
  solarSavingEstimate,
  periodNav,
  shortMonth,
  solarYield,
  yearMonths,
} from "@/domain/overview";

const TODAY = "2026-10-03";

describe("peakSplit", () => {
  it("regroupe les créneaux HP et HC (Tempo compris) ; le reste à part", () => {
    expect(
      peakSplit({
        hp: { kwh: 100, energyCents: 2500 },
        hc: { kwh: 50, energyCents: 900 },
        blue_hp: { kwh: 20, energyCents: 300 },
        red_hc: { kwh: 10, energyCents: 150 },
        base: { kwh: 5, energyCents: 100 },
      }),
    ).toEqual({
      hp: { kwh: 120, energyCents: 2800 },
      hc: { kwh: 60, energyCents: 1050 },
      otherKwh: 5,
    });
  });

  it("aucun kWh en HP ni en HC : null", () => {
    expect(peakSplit({ base: { kwh: 5, energyCents: 100 } })).toBeNull();
    expect(peakSplit({})).toBeNull();
  });
});

describe("slotHpHc", () => {
  it("additionne HP et HC, Tempo compris ; le reste à part", () => {
    expect(slotHpHc({ hp: 10, hc: 5, blue_hp: 2, red_hc: 1, base: 3 })).toEqual({
      hp: 12,
      hc: 6,
      other: 3,
    });
  });
});

describe("solarSavingEstimate", () => {
  const month = { solar: 400, gridExport: 50, batteryCharge: 100, batteryChargeGrid: 20 };
  it("autoconsommation directe au prix moyen du kWh du mois", () => {
    // 400 − 50 − 100 = 250 kWh × 20 c
    expect(
      solarSavingEstimate(month, {
        avgPriceCents: 20,
        gridCharging: false,
        exportPriceCents: null,
      }),
    ).toBe(5000);
  });
  it("charge réseau déduite de la charge solaire ; revente ajoutée", () => {
    // 400 − 50 − (100 − 20) = 270 kWh × 20 c + 50 × 10 c
    expect(
      solarSavingEstimate(month, { avgPriceCents: 20, gridCharging: true, exportPriceCents: 10 }),
    ).toBe(5900);
  });
  it("prix inconnu (aucun soutirage chiffré) : null", () => {
    expect(
      solarSavingEstimate(month, {
        avgPriceCents: null,
        gridCharging: false,
        exportPriceCents: null,
      }),
    ).toBeNull();
  });
});

describe("shortMonth", () => {
  it("mois abrégé d'une clé AAAA-MM", () => {
    expect(shortMonth("2026-02")).toBe("févr.");
    expect(shortMonth("2026-12")).toBe("déc.");
  });
});

describe("parsePeriod", () => {
  it("mois ou année ; par défaut le mois en cours ; fin bornée au lendemain d'aujourd'hui", () => {
    expect(parsePeriod("2026-09", TODAY)).toEqual({
      kind: "month",
      key: "2026-09",
      from: "2026-09-01",
      to: "2026-10-01",
      label: "septembre 2026",
      complete: true,
    });
    expect(parsePeriod(undefined, TODAY)).toMatchObject({
      key: "2026-10",
      from: "2026-10-01",
      to: "2026-10-04",
      complete: false,
    });
    expect(parsePeriod("2026", TODAY)).toMatchObject({
      kind: "year",
      from: "2026-01-01",
      to: "2026-10-04",
      label: "2026",
    });
    expect(parsePeriod("2025", TODAY)).toMatchObject({ to: "2026-01-01", complete: true });
  });

  it("une saisie invalide ou future retombe sur le mois en cours", () => {
    expect(parsePeriod("2026-13", TODAY).key).toBe("2026-10");
    expect(parsePeriod("n'importe quoi", TODAY).key).toBe("2026-10");
    expect(parsePeriod("2027-01", TODAY).key).toBe("2026-10");
  });
});

describe("periodNav", () => {
  it("précédent jusqu'à la première donnée, suivant jusqu'au mois en cours", () => {
    expect(periodNav(parsePeriod("2026-09", TODAY), "2024-10-03", TODAY)).toEqual({
      prev: "2026-08",
      next: "2026-10",
    });
    expect(periodNav(parsePeriod("2024-10", TODAY), "2024-10-03", TODAY)).toEqual({
      prev: null,
      next: "2024-11",
    });
    expect(periodNav(parsePeriod("2026", TODAY), "2024-10-03", TODAY)).toEqual({
      prev: "2025",
      next: null,
    });
    expect(periodNav(parsePeriod("2024", TODAY), "2024-10-03", TODAY).prev).toBeNull();
  });
});

describe("yearMonths", () => {
  it("les 12 mois de l'année, sans ceux après aujourd'hui", () => {
    expect(yearMonths("2026", TODAY)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(yearMonths("2025", TODAY)).toHaveLength(12);
  });
});

describe("energyBalance", () => {
  const totals = {
    grid_import: 200,
    grid_export: 40,
    solar_production: 300,
    battery_charge: 60,
    battery_discharge: 50,
  };

  it("consommation du foyer et origine : réseau, solaire direct, batterie", () => {
    const b = energyBalance(totals, { batteryGridCharging: false });
    // 200 + 300 + 50 − 40 − 60
    expect(b.consumption).toBe(450);
    expect(b.origin).toEqual({ grid: 200, solar: 200, battery: 50 });
    expect(b.selfConsumptionRate).toBeCloseTo(260 / 300, 6);
  });

  it("charge depuis le réseau : retirée de la part réseau, pas du solaire", () => {
    const b = energyBalance({ ...totals, battery_charge_grid: 20 }, { batteryGridCharging: true });
    expect(b.origin).toEqual({ grid: 180, solar: 220, battery: 50 });
    expect(b.consumption).toBe(450);
  });

  it("sans solaire ni batterie : tout vient du réseau ; métriques absentes = 0", () => {
    const b = energyBalance({ grid_import: 12 }, { batteryGridCharging: false });
    expect(b).toMatchObject({ consumption: 12, origin: { grid: 12, solar: 0, battery: 0 } });
    expect(b.selfConsumptionRate).toBeNull();
  });
});

describe("solarYield", () => {
  it("kWh produits par kWh/m² reçu ; null sans irradiation", () => {
    expect(solarYield(300, 150)).toBe(2);
    expect(solarYield(300, 0)).toBeNull();
    expect(solarYield(300, null)).toBeNull();
  });
});

describe("couverture", () => {
  it("fenêtre : jours terminés de la période ; vide le premier jour du mois en cours", () => {
    expect(coverageWindow(parsePeriod("2026-09", TODAY), TODAY)).toEqual({
      from: "2026-09-01",
      to: "2026-10-01",
    });
    expect(coverageWindow(parsePeriod("2026-10", TODAY), TODAY)).toEqual({
      from: "2026-10-01",
      to: "2026-10-03",
    });
    expect(coverageWindow(parsePeriod("2026-10", "2026-10-01"), "2026-10-01")).toBeNull();
  });

  it("créneaux attendus : heures réelles (changement d'heure compris) ou jours", () => {
    expect(expectedSlots("2026-09-01", "2026-10-01", "hourly", "Europe/Paris")).toBe(720);
    // 25 octobre 2026 : passage à l'heure d'hiver, journée de 25 h
    expect(expectedSlots("2026-10-25", "2026-10-26", "hourly", "Europe/Paris")).toBe(25);
    expect(expectedSlots("2026-09-01", "2026-10-01", "daily", "Europe/Paris")).toBe(30);
  });
});
