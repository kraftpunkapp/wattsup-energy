import { describe, expect, it } from "vitest";
import { withActuals } from "@/domain/forecast/actuals";
import { daySummaries } from "@/domain/forecast/summary";

// Heures écoulées d'aujourd'hui : le mesuré remplace la prévision (T79b, SPEC §7.14). Une
// heure pas encore reçue, ou en cours, reste prévue. Novembre, UTC+1.

const TZ = "Europe/Paris";
const HOUR = 3_600_000;
const local = (h: number) => new Date(Date.parse("2026-11-22T00:00:00Z") + (h - 1) * HOUR);
const forecast = (h: number) => ({
  start: local(h),
  solarKwh: 1,
  loadKwh: 2,
  importKwh: 1,
  exportKwh: 0,
  socKwh: 0,
});

describe("withActuals", () => {
  it("heures écoulées reçues : mesurées ; en cours et à venir : prévues", () => {
    const hours = [8, 9, 10, 11].map(forecast);
    const actuals = new Map([
      [local(8).getTime(), { solarKwh: 0.5, importKwh: 2, exportKwh: 0, loadKwh: 2.5 }],
      [local(10).getTime(), { solarKwh: 3, importKwh: 0, exportKwh: 1.2, loadKwh: 1.8 }],
    ]);
    // Il est 10 h 20 : 8 h mesurée, 9 h pas encore reçue (prévue), 10 h en cours (prévue).
    const r = withActuals(hours, actuals, local(10).getTime() + 20 * 60_000);
    expect(r.map((h) => [h.measured, h.loadKwh])).toEqual([
      [true, 2.5],
      [false, 2],
      [false, 2],
      [false, 2],
    ]);
    expect(r[0]).toMatchObject({ solarKwh: 0.5, importKwh: 2, exportKwh: 0 });
  });
});

describe("withActuals : ce qui était estimé", () => {
  it("prévision figée la veille si elle existe, sinon l'estimation du modèle", () => {
    const hours = [8, 9].map(forecast);
    const actuals = new Map([
      [local(8).getTime(), { solarKwh: 0.5, importKwh: 2, exportKwh: 0, loadKwh: 2.5 }],
      [local(9).getTime(), { solarKwh: 1.5, importKwh: 1, exportKwh: 0, loadKwh: 2.5 }],
    ]);
    const frozen = new Map([[local(8).getTime(), { solarKwh: 0.8, loadKwh: 3 }]]);
    const r = withActuals(hours, actuals, local(11).getTime(), frozen);
    expect(r.map((h) => h.estimated)).toEqual([
      { solarKwh: 0.8, loadKwh: 3 },
      { solarKwh: 1, loadKwh: 2 },
    ]);
  });
});

describe("daySummaries avec le mesuré", () => {
  it("totaux du jour, dont la part déjà mesurée", () => {
    const hours = [
      { ...forecast(8), solarKwh: 0.5, loadKwh: 2.5, importKwh: 2, measured: true },
      { ...forecast(14), measured: false },
    ];
    expect(daySummaries(hours, null, TZ)[0]).toMatchObject({
      solarKwh: 1.5,
      loadKwh: 4.5,
      measured: { solarKwh: 0.5, loadKwh: 2.5, hours: 1 },
    });
  });
});
