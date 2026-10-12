import { describe, expect, it } from "vitest";
import { EnergyChartsSource } from "@/server/spot/source";

describe("EnergyChartsSource", () => {
  it("demande la zone France sur la période, renvoie les moyennes horaires", async () => {
    const calls: string[] = [];
    const source = new EnergyChartsSource({
      fetchFn: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({ unix_seconds: [1704063600], price: [42.5] }));
      },
      sleep: async () => {},
    });
    expect(await source.prices("2024-01-01", "2024-01-31")).toEqual([
      { start: new Date(1704063600 * 1000), eurMwh: 42.5 },
    ]);
    expect(calls).toEqual([
      "https://api.energy-charts.info/price?bzn=FR&start=2024-01-01&end=2024-01-31",
    ]);
  });

  it("refuse une période mal formée sans appel réseau", async () => {
    let called = false;
    const source = new EnergyChartsSource({
      fetchFn: async () => {
        called = true;
        return new Response("{}");
      },
    });
    await expect(source.prices("2024-1-1", "x")).rejects.toThrow(/invalide/);
    expect(called).toBe(false);
  });
});

describe("limite de débit", () => {
  it("réessaie après une réponse 429", async () => {
    let n = 0;
    const waits: number[] = [];
    const source = new EnergyChartsSource({
      fetchFn: async () =>
        ++n === 1
          ? new Response("{}", { status: 429 })
          : new Response(JSON.stringify({ unix_seconds: [], price: [] })),
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(await source.prices("2024-01-01", "2024-01-02")).toEqual([]);
    expect(waits).toEqual([5000, 500]);
  });
});
