import { describe, expect, it } from "vitest";
import { needsOffPeakCheck } from "@/domain/tariff/off-peak";
import { CONTRACT_PRESETS } from "@/domain/tariff/schema";

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
