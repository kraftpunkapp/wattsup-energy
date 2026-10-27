import { describe, expect, it } from "vitest";
import { daySummaries, windowLabel } from "@/domain/forecast/summary";

// Bilan de chaque jour prévu et libellés des créneaux (T72, SPEC §7.14). Novembre, UTC+1.

const TZ = "Europe/Paris";
const HOUR = 3_600_000;
const local = (date: string, h: number, m = 0) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (h - 1) * HOUR + m * 60_000);

describe("daySummaries", () => {
  it("totaux par jour local ; achats chiffrés au prix de chaque heure", () => {
    const hours = [
      { start: local("2026-11-22", 3), solarKwh: 0, loadKwh: 1, importKwh: 1, exportKwh: 0 },
      { start: local("2026-11-22", 12), solarKwh: 3, loadKwh: 1, importKwh: 0, exportKwh: 2 },
      { start: local("2026-11-23", 20), solarKwh: 0, loadKwh: 2, importKwh: 2, exportKwh: 0 },
    ];
    const r = daySummaries(hours, [0.2, 0.27, 0.27], TZ);
    expect(r).toEqual([
      {
        date: "2026-11-22",
        solarKwh: 3,
        loadKwh: 2,
        importKwh: 1,
        exportKwh: 2,
        costEur: 0.2,
        measured: { solarKwh: 0, loadKwh: 0, hours: 0 },
      },
      {
        date: "2026-11-23",
        solarKwh: 0,
        loadKwh: 2,
        importKwh: 2,
        exportKwh: 0,
        costEur: expect.closeTo(0.54, 9),
        measured: { solarKwh: 0, loadKwh: 0, hours: 0 },
      },
    ]);
    expect(daySummaries(hours, null, TZ)[0]?.costEur).toBeNull();
  });
});

describe("windowLabel", () => {
  it("jour relatif et heures, minutes seulement si besoin", () => {
    const today = "2026-11-22";
    expect(windowLabel(local(today, 13), local(today, 15), today, TZ)).toBe(
      "aujourd'hui, 13 h – 15 h",
    );
    expect(windowLabel(local("2026-11-23", 21, 30), local("2026-11-23", 23, 30), today, TZ)).toBe(
      "demain, 21 h 30 – 23 h 30",
    );
    // Passe minuit : jour du départ.
    expect(windowLabel(local(today, 23), local("2026-11-23", 3), today, TZ)).toBe(
      "aujourd'hui, 23 h – 3 h",
    );
  });
});
