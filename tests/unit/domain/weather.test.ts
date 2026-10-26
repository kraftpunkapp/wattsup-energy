import { describe, expect, it } from "vitest";
import {
  cellOf,
  dju,
  parseGeocoding,
  parseOpenMeteoDaily,
  parseOpenMeteoHourly,
  radiationKwhM2,
  roundCoord,
  sunshineHours,
} from "@/domain/weather";
import archive from "../../fixtures/open-meteo/archive-paris.json";
import forecast from "../../fixtures/open-meteo/forecast-paris.json";
import geocode from "../../fixtures/open-meteo/geocode-valence.json";
import hourly from "../../fixtures/open-meteo/forecast-hourly.json";

describe("maille et arrondis", () => {
  it("arrondit les coordonnées à 0,01°, y compris en longitude négative", () => {
    expect(roundCoord(47.32545)).toBe(47.33);
    expect(roundCoord(-1.73732)).toBe(-1.74);
    expect(cellOf({ lat: 47.32545, lon: -1.73732 })).toEqual({ latE2: 4733, lonE2: -174 });
  });

  it("deux points à moins de 500 m tombent dans la même maille", () => {
    expect(cellOf({ lat: 48.856, lon: 2.352 })).toEqual(cellOf({ lat: 48.8649, lon: 2.3549 }));
  });
});

describe("conversions et DJU", () => {
  it("DJU base 18 °C, nul au-dessus", () => {
    expect(dju(12.4)).toBeCloseTo(5.6, 10);
    expect(dju(21)).toBe(0);
    expect(dju(null)).toBeNull();
  });

  it("secondes d'ensoleillement → heures, MJ/m² → kWh/m²", () => {
    expect(sunshineHours(39_600)).toBe(11);
    expect(radiationKwhM2(15)).toBeCloseTo(4.1667, 4);
    expect(sunshineHours(null)).toBeNull();
  });
});

describe("parseOpenMeteoDaily", () => {
  it("lit la réponse forecast (7 jours passés + aujourd'hui)", () => {
    const days = parseOpenMeteoDaily(forecast);
    expect(days).toHaveLength(8);
    expect(days[0]).toEqual({
      date: "2026-09-26",
      tMin: 15.5,
      tMax: 22.1,
      tMean: 18.8,
      sunshineS: 22489.04,
      radiationMjM2: 8.51,
    });
  });

  it("lit la réponse archive", () => {
    const days = parseOpenMeteoDaily(archive);
    expect(days).toHaveLength(10);
    expect(days.at(-1)?.date).toBe("2026-10-02");
  });

  it("garde les valeurs nulles, ignore les jours entièrement vides", () => {
    const days = parseOpenMeteoDaily({
      daily: {
        time: ["2026-10-01", "2026-10-02"],
        temperature_2m_min: [8, null],
        temperature_2m_max: [17, null],
        temperature_2m_mean: [12, null],
        sunshine_duration: [null, null],
        shortwave_radiation_sum: [9.1, null],
      },
    });
    expect(days).toEqual([
      { date: "2026-10-01", tMin: 8, tMax: 17, tMean: 12, sunshineS: null, radiationMjM2: 9.1 },
    ]);
  });

  it("rejette une réponse inattendue", () => {
    expect(() => parseOpenMeteoDaily({ error: true, reason: "x" })).toThrow();
    expect(() =>
      parseOpenMeteoDaily({ daily: { time: ["2026-10-01"], temperature_2m_min: [] } }),
    ).toThrow();
  });
});

describe("parseGeocoding", () => {
  it("communes françaises d'abord, coordonnées arrondies, libellé avec département", () => {
    const results = parseGeocoding(geocode);
    expect(results[0]).toEqual({ label: "Valence (Drôme)", lat: 44.93, lon: 4.91, country: "FR" });
    expect(results.at(-1)?.country).toBe("ES");
    expect(results.filter((r) => r.country === "FR")).toHaveLength(7);
  });

  it("aucun résultat : liste vide", () => {
    expect(parseGeocoding({})).toEqual([]);
  });
});

describe("parseOpenMeteoHourly (T67)", () => {
  it("rayonnement : moyenne de l'heure précédente, rangé au début de cette heure", () => {
    const at = (iso: string) => new Date(iso);
    expect(parseOpenMeteoHourly(hourly)).toEqual([
      { start: at("2026-10-19T09:00:00Z"), radiationWm2: 310, temperatureC: null },
      { start: at("2026-10-19T10:00:00Z"), radiationWm2: 420.5, temperatureC: 12.1 },
      { start: at("2026-10-19T11:00:00Z"), radiationWm2: null, temperatureC: 13.4 },
      { start: at("2026-10-19T12:00:00Z"), radiationWm2: 380, temperatureC: 14 },
    ]);
  });

  it("réponse inattendue : erreur", () => {
    expect(() => parseOpenMeteoHourly({ hourly: { time: [1] } })).toThrow();
  });
});
