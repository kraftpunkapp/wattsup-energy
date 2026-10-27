import { describe, expect, it } from "vitest";
import { BATTERY_LEVEL, isSuspect, metricLabel, valueCap } from "@/domain/ingest/metrics";

describe("metricLabel", () => {
  it("compteur, poste nommé, poste supprimé ; majuscule à la demande", () => {
    expect(metricLabel("grid_import", {})).toBe("import réseau");
    expect(metricLabel("grid_import", {}, true)).toBe("Import réseau");
    expect(metricLabel("category:ballon", { ballon: "Chauffe-eau" })).toBe("Chauffe-eau");
    expect(metricLabel("category:ancien", {})).toBe("« ancien »");
    expect(metricLabel("autre", {})).toBe("autre");
    expect(metricLabel(BATTERY_LEVEL, {}, true)).toBe("Niveau de la batterie (%)");
  });
});

describe("valeurs suspectes", () => {
  it("seuil du compteur par heure, × 24 par jour", () => {
    expect(valueCap("battery_charge", "hour")).toBe(20);
    expect(valueCap("grid_import", "day")).toBe(864);
    expect(isSuspect("battery_charge", "hour", 20)).toBe(false);
    expect(isSuspect("battery_charge", "hour", 20.5)).toBe(true);
    expect(isSuspect("category:x", "day", 900)).toBe(true);
  });
});
