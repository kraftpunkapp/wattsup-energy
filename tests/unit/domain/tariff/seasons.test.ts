import { describe, expect, it } from "vitest";
import { monthsLabel, monthsPreset, SUMMER_MONTHS, WINTER_MONTHS } from "@/domain/tariff/seasons";

describe("mois d'une règle", () => {
  it("reconnaît l'année entière, l'hiver et l'été, dans n'importe quel ordre", () => {
    expect(monthsPreset(undefined)).toBe("all");
    expect(monthsPreset([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe("all");
    expect(monthsPreset([1, 2, 3, 11, 12])).toBe("winter");
    expect(monthsPreset(SUMMER_MONTHS)).toBe("summer");
    expect(monthsPreset([6, 7, 8])).toBe("custom");
  });

  it("libellés", () => {
    expect(monthsLabel(undefined)).toBeNull();
    expect(monthsLabel(WINTER_MONTHS)).toBe("hiver (nov. – mars)");
    expect(monthsLabel(SUMMER_MONTHS)).toBe("été (avr. – oct.)");
    expect(monthsLabel([8, 7, 6])).toBe("juin, juil., août");
  });
});
