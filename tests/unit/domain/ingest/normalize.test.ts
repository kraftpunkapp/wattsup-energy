import { describe, expect, it } from "vitest";
import { dailyToIntervals, hourlyReadings } from "@/domain/ingest/normalize";
import { parseIngestPayload, type DailyPayload, type HourlyPayload } from "@/domain/ingest/schema";
import hourlyFull from "../../../fixtures/payloads/hourly-full.json";
import dailyHphc from "../../../fixtures/payloads/daily-hphc.json";
import dailyBase from "../../../fixtures/payloads/daily-base.json";

function parse<K extends "hourly" | "daily">(json: unknown, kind: K) {
  const r = parseIngestPayload(json);
  if (!r.success || r.data.kind !== kind) throw new Error(`fixture ${kind} invalide`);
  return r.data as K extends "hourly" ? HourlyPayload : DailyPayload;
}

describe("dailyToIntervals", () => {
  it("ventile l'import réseau en HP et HC, les autres métriques sans créneau", () => {
    const r = dailyToIntervals(parse(dailyHphc, "daily"), ["eau-chaude"]);
    expect(r.warnings).toEqual([]);
    expect(r.intervals).toEqual(
      expect.arrayContaining([
        { metric: "grid_import", date: "2026-10-01", slot: "hp", kwh: 6.82 },
        { metric: "grid_import", date: "2026-10-01", slot: "hc", kwh: 5.31 },
        { metric: "grid_export", date: "2026-10-01", slot: null, kwh: 2.4 },
        { metric: "solar_production", date: "2026-10-01", slot: null, kwh: 11.9 },
        { metric: "battery_charge", date: "2026-10-01", slot: null, kwh: 3.2 },
        { metric: "battery_discharge", date: "2026-10-01", slot: null, kwh: 2.9 },
        { metric: "category:eau-chaude", date: "2026-10-01", slot: null, kwh: 2.1 },
      ]),
    );
    expect(r.intervals).toHaveLength(7);
  });

  it("contrat Base : import réseau sans créneau", () => {
    const r = dailyToIntervals(parse(dailyBase, "daily"), []);
    expect(r.intervals).toEqual([
      { metric: "grid_import", date: "2026-10-01", slot: null, kwh: 12.13 },
    ]);
  });

  it("catégorie inconnue : ignorée avec avertissement", () => {
    const r = dailyToIntervals(parse(dailyHphc, "daily"), []);
    expect(r.intervals.some((i) => i.metric.startsWith("category:"))).toBe(false);
    expect(r.warnings).toEqual([{ code: "unknown_category", key: "eau-chaude" }]);
  });
});

describe("hourlyReadings", () => {
  it("extrait un index par métrique présente, catégories préfixées", () => {
    const p = parse(hourlyFull, "hourly");
    const r = hourlyReadings(p, ["eau-chaude", "chauffage-electrique"]);
    expect(r.warnings).toEqual([]);
    expect(r.readings).toHaveLength(8);
    expect(r.readings).toContainEqual({ metric: "grid_import", ts: p.ts, value: 18234.512 });
    expect(r.readings).toContainEqual({
      metric: "category:chauffage-electrique",
      ts: p.ts,
      value: 1450,
    });
  });

  it("catégorie inconnue : ignorée avec avertissement", () => {
    const r = hourlyReadings(parse(hourlyFull, "hourly"), ["eau-chaude"]);
    expect(r.readings.some((x) => x.metric === "category:chauffage-electrique")).toBe(false);
    expect(r.warnings).toEqual([{ code: "unknown_category", key: "chauffage-electrique" }]);
  });
});

describe("import réseau absent", () => {
  it("horaire : avertissement missing_grid_import si d'autres compteurs sont envoyés", () => {
    const p = parse(
      { version: 1, ts: "2026-10-02T12:00:00Z", energy: { solar_production_kwh: 120.5 } },
      "hourly",
    );
    expect(hourlyReadings(p, []).warnings).toEqual([{ code: "missing_grid_import" }]);
  });

  it("quotidien : même avertissement, import réseau ni total ni HP/HC", () => {
    const p = parse({ version: 1, date: "2026-10-02", solar_production_kwh: 11.9 }, "daily");
    expect(dailyToIntervals(p, []).warnings).toEqual([{ code: "missing_grid_import" }]);
  });
});

describe("payload sans aucune donnée d'énergie", () => {
  it("quotidien : avertissement no_energy_data", () => {
    const r = dailyToIntervals(parse({ version: 1, date: "2026-10-02" }, "daily"), []);
    expect(r.intervals).toEqual([]);
    expect(r.warnings).toEqual([{ code: "no_energy_data" }]);
  });

  it("horaire : avertissement no_energy_data, même avec une couleur Tempo", () => {
    const p = parse({ version: 1, ts: "2026-10-02T12:00:00Z", tempo_color: "bleu" }, "hourly");
    expect(hourlyReadings(p, []).warnings).toEqual([{ code: "no_energy_data" }]);
  });

  it("seules des catégories inconnues : les deux avertissements", () => {
    const p = parse({ version: 1, date: "2026-10-02", categories: { piscine: 3 } }, "daily");
    expect(dailyToIntervals(p, []).warnings).toEqual([
      { code: "unknown_category", key: "piscine" },
      { code: "no_energy_data" },
    ]);
  });
});
