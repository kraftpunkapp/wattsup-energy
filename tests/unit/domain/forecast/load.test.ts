import { describe, expect, it } from "vitest";
import { forecastDayLoad, heatingSlope } from "@/domain/forecast/load";
import { simulateBattery } from "@/domain/forecast/battery";

// Consommation prévue et batterie simulée (T69, SPEC §7.14). Novembre, UTC+1 : minuit local
// = 23 h UTC la veille.

const TZ = "Europe/Paris";
const HOUR = 3_600_000;
/** Début de l'heure locale `h` du jour local `date` (novembre, UTC+1). */
const at = (date: string, h: number) => new Date(Date.parse(`${date}T00:00:00Z`) - HOUR + h * HOUR);
const day = (date: string, kwh: (h: number) => number, hours = 24) =>
  Array.from({ length: hours }, (_, h) => ({ start: at(date, h), kwh: kwh(h) }));

/** Du lundi 2 au dimanche 29 novembre 2026 : semaine 1 kWh/h, samedi 2, dimanche 3. */
function weeks() {
  const out: { start: Date; kwh: number }[] = [];
  for (let d = 2; d <= 29; d++) {
    const date = `2026-11-${String(d).padStart(2, "0")}`;
    const weekday = ((d - 2) % 7) + 1; // le 2 novembre 2026 est un lundi
    out.push(...day(date, () => (weekday === 6 ? 2 : weekday === 7 ? 3 : 1)));
  }
  return out;
}

describe("forecastDayLoad", () => {
  it("même type de jour : les 4 derniers samedis pour un samedi", () => {
    const r = forecastDayLoad({
      history: weeks(),
      date: "2026-12-05",
      timezone: TZ,
      heating: null,
    });
    expect(r).toEqual(Array(24).fill(2));
  });

  it("médiane heure par heure : un pic isolé ne déforme pas le profil", () => {
    const history = weeks().map((x) =>
      x.start.getTime() === at("2026-11-25", 8).getTime() ? { ...x, kwh: 10 } : x,
    );
    const r = forecastDayLoad({ history, date: "2026-11-30", timezone: TZ, heating: null });
    expect(r?.[8]).toBe(1);
  });

  it("jour incomplet (moins de 20 heures) écarté ; aucun historique → null", () => {
    const history = [
      ...weeks().filter((x) => x.start < at("2026-11-28", 0)),
      ...day("2026-11-28", () => 9, 10),
    ];
    expect(forecastDayLoad({ history, date: "2026-12-05", timezone: TZ, heating: null })?.[3]).toBe(
      2,
    );
    expect(
      forecastDayLoad({ history: [], date: "2026-12-05", timezone: TZ, heating: null }),
    ).toBeNull();
  });

  it("chauffage : écart de degrés-jours × pente, réparti sur le profil", () => {
    // Samedis de référence à 5 degrés-jours en moyenne ; demain 10 : +2 × 5 = +10 kWh.
    const hdd = new Map(
      ["2026-11-07", "2026-11-14", "2026-11-21", "2026-11-28"].map((d) => [d, 5]),
    );
    const r = forecastDayLoad({
      history: weeks(),
      date: "2026-12-05",
      timezone: TZ,
      heating: { slope: 2, hddByDate: hdd, targetHdd: 10 },
    });
    expect(r?.reduce((a, b) => a + b, 0)).toBeCloseTo(48 + 10, 6);
  });
});

describe("heatingSlope", () => {
  it("kWh par degré-jour, moindres carrés ; jamais négative ; trop peu de jours → 0", () => {
    const days = Array.from({ length: 20 }, (_, i) => ({ load: 10 + 2 * i, hdd: i }));
    expect(heatingSlope(days)).toBeCloseTo(2, 6);
    expect(heatingSlope(days.map((d) => ({ ...d, load: 50 - d.hdd })))).toBe(0);
    expect(heatingSlope(days.slice(0, 5))).toBe(0);
  });
});

describe("simulateBattery", () => {
  it("le surplus charge la batterie (90 %), le reste part au réseau ; le soir elle se vide", () => {
    const hours = Array.from({ length: 24 }, (_, h) => ({
      start: at("2026-12-05", h),
      solarKwh: h >= 10 && h < 14 ? 3 : 0,
      loadKwh: h >= 10 && h < 14 ? 1 : h >= 18 ? 1 : 0,
    }));
    const r = simulateBattery(hours, 5, TZ);
    const h = (n: number) => r.hours[n];
    expect(h(10)).toMatchObject({ importKwh: 0, exportKwh: 0, socKwh: expect.closeTo(1.8, 6) });
    expect(h(12)?.exportKwh).toBeCloseTo(2 - 1.4 / 0.9, 6);
    expect(h(12)?.socKwh).toBeCloseTo(5, 6);
    expect(h(13)?.exportKwh).toBeCloseTo(2, 6);
    expect(r.fullAt).toEqual([{ date: "2026-12-05", start: at("2026-12-05", 12) }]);
    // Soir : 6 kWh consommés, 5 en batterie, 1 acheté.
    const evening = r.hours.slice(18).reduce((a, x) => a + x.importKwh, 0);
    expect(evening).toBeCloseTo(1, 6);
  });

  it("sans batterie : surplus exporté, manque acheté", () => {
    const r = simulateBattery(
      [
        { start: at("2026-12-05", 12), solarKwh: 2, loadKwh: 0.5 },
        { start: at("2026-12-05", 20), solarKwh: 0, loadKwh: 1 },
      ],
      0,
      TZ,
    );
    expect(r.hours.map((x) => [x.exportKwh, x.importKwh])).toEqual([
      [1.5, 0],
      [0, 1],
    ]);
    expect(r.fullAt).toEqual([]);
  });
});
