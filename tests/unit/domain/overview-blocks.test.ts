import { describe, expect, it } from "vitest";
import { applicableBlocks, hiddenBlocks, withBlockHidden } from "@/domain/overview-blocks";

describe("hiddenBlocks", () => {
  it("blocs connus seulement, sans doublon", () => {
    expect(hiddenBlocks({ hidden: ["baseload", "inconnu", "baseload", 3] })).toEqual(["baseload"]);
    expect(hiddenBlocks(undefined)).toEqual([]);
    expect(hiddenBlocks({ hidden: "peak" })).toEqual([]);
  });

  it("masquer puis réafficher", () => {
    const hidden = withBlockHidden([], "peak", true);
    expect(hidden).toEqual(["peak"]);
    expect(withBlockHidden(hidden, "peak", true)).toEqual(["peak"]);
    expect(withBlockHidden(hidden, "peak", false)).toEqual([]);
  });
});

describe("applicableBlocks", () => {
  it("selon le profil, le contrat et les envois", () => {
    expect(
      applicableBlocks({
        solar: false,
        granularity: "daily",
        contractKind: "base",
        contracts: 1,
        payment: false,
      }),
    ).toEqual([]);
    expect(
      applicableBlocks({
        solar: true,
        granularity: "hourly",
        contractKind: "tempo",
        contracts: 3,
        payment: true,
      }),
    ).toEqual(["advice", "contract", "payment", "peak", "baseload"]);
    expect(
      applicableBlocks({
        solar: false,
        granularity: "hourly",
        contractKind: "hphc",
        contracts: 1,
        payment: false,
      }),
    ).toEqual(["advice", "peak", "baseload"]);
  });
});
