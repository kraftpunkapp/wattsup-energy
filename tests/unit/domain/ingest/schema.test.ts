import { describe, expect, it } from "vitest";
import { parseIngestPayload } from "@/domain/ingest/schema";
import hourlyFull from "../../../fixtures/payloads/hourly-full.json";
import hourlyMinimal from "../../../fixtures/payloads/hourly-minimal.json";
import dailyHphc from "../../../fixtures/payloads/daily-hphc.json";
import dailyBase from "../../../fixtures/payloads/daily-base.json";
import invalidCases from "../../../fixtures/payloads/invalid-cases.json";

describe("parseIngestPayload", () => {
  it("accepte un payload horaire complet et le marque hourly", () => {
    const r = parseIngestPayload(hourlyFull);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.kind).toBe("hourly");
    if (r.data.kind !== "hourly") return;
    expect(r.data.ts.toISOString()).toBe("2026-10-02T12:00:00.000Z");
    expect(r.data.energy?.grid_import_kwh).toBe(18234.512);
  });

  it("accepte un payload horaire minimal", () => {
    expect(parseIngestPayload(hourlyMinimal).success).toBe(true);
  });

  it("accepte un payload quotidien HP/HC et un payload quotidien Base", () => {
    const hphc = parseIngestPayload(dailyHphc);
    const base = parseIngestPayload(dailyBase);
    expect(hphc.success && hphc.data.kind).toBe("daily");
    expect(base.success && base.data.kind).toBe("daily");
  });

  it("ignore les clés inconnues au premier niveau (compatibilité ascendante)", () => {
    const r = parseIngestPayload({ ...hourlyMinimal, future_field: 42 });
    expect(r.success).toBe(true);
  });

  it.each(Object.entries(invalidCases))("rejette : %s", (_name, payload) => {
    const r = parseIngestPayload(payload);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.errors.length).toBeGreaterThan(0);
    for (const e of r.errors) {
      expect(typeof e.path).toBe("string");
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it("niveau de la batterie (T78) : facultatif, en %, entre 0 et 100", () => {
    const at = { version: 1, ts: "2026-10-02T12:00:00Z" };
    const ok = parseIngestPayload({ ...at, battery_soc_percent: 47.5 });
    expect(ok.success && ok.data.kind === "hourly" && ok.data.battery_soc_percent).toBe(47.5);
    const bad = parseIngestPayload({ ...at, battery_soc_percent: 120 });
    expect(bad.success ? [] : bad.errors.map((e) => e.path)).toEqual(["battery_soc_percent"]);
  });

  it("rejette ce qui n'est pas un objet", () => {
    expect(parseIngestPayload(null).success).toBe(false);
    expect(parseIngestPayload("hello").success).toBe(false);
  });

  it("indique le chemin du champ fautif", () => {
    const r = parseIngestPayload({
      version: 1,
      ts: "2026-10-02T12:00:00Z",
      energy: { grid_import_kwh: -1 },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.errors[0]?.path).toBe("energy.grid_import_kwh");
  });
});
