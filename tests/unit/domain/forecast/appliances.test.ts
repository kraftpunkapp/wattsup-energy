import { describe, expect, it } from "vitest";
import { APPLIANCE_PRESETS, describeAppliance, parseAppliance } from "@/domain/forecast/appliances";

// Appareils déplaçables (T71, SPEC §7.14) : liste type proposée, saisie validée en français.

describe("APPLIANCE_PRESETS", () => {
  it("lave-linge, lave-vaisselle, ballon et véhicule, avec puissance et durée", () => {
    expect(APPLIANCE_PRESETS.map((p) => [p.name, p.powerKw, p.durationMin])).toEqual([
      ["Lave-linge", 2, 120],
      ["Lave-vaisselle", 1.5, 120],
      ["Ballon d'eau chaude", 2.4, 180],
      ["Recharge du véhicule", 3.7, 240],
    ]);
    for (const p of APPLIANCE_PRESETS) expect(parseAppliance(p).ok).toBe(true);
  });
});

describe("parseAppliance", () => {
  it("puissance en kW (virgule acceptée), durée au quart d'heure", () => {
    expect(
      parseAppliance({
        name: " Sèche-linge ",
        icon: "plug",
        powerKw: "2,5",
        durationMin: 90,
        allowedFrom: 8,
        allowedTo: 22,
      }),
    ).toEqual({
      ok: true,
      value: {
        name: "Sèche-linge",
        icon: "plug",
        powerKw: 2.5,
        durationMin: 90,
        allowedFrom: 8,
        allowedTo: 22,
      },
    });
  });

  it("refus en français", () => {
    const r = parseAppliance({
      name: "",
      icon: "x",
      powerKw: 0,
      durationMin: 50,
      allowedFrom: 25,
      allowedTo: 0,
    });
    expect(r.ok ? [] : r.errors).toEqual([
      "nom requis",
      "icône inconnue",
      "puissance entre 0,1 et 22 kW",
      "durée au quart d'heure, de 15 min à 12 h",
      "heure de début invalide",
    ]);
  });
});

describe("describeAppliance", () => {
  it("puissance, durée et plage, en clair", () => {
    expect(describeAppliance({ powerKw: 2, durationMin: 120, allowedFrom: 8, allowedTo: 22 })).toBe(
      "2 kW · 2 h · de 8 h à 22 h",
    );
    expect(describeAppliance({ powerKw: 3.7, durationMin: 90, allowedFrom: 0, allowedTo: 0 })).toBe(
      "3,7 kW · 1 h 30 · à toute heure",
    );
  });
});
