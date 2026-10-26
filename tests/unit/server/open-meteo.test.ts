import { describe, expect, it } from "vitest";
import { OpenMeteoSource } from "@/server/weather/open-meteo";
import forecast from "../../fixtures/open-meteo/forecast-paris.json";
import geocode from "../../fixtures/open-meteo/geocode-valence.json";
import hourly from "../../fixtures/open-meteo/forecast-hourly.json";

// Aucun appel réseau : fetch est remplacé par une file de réponses scriptées.

function scripted(responses: (Response | Error)[]) {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    const next = responses.shift();
    if (!next) throw new Error("plus de réponse scriptée");
    if (next instanceof Error) throw next;
    return next;
  };
  const source = new OpenMeteoSource({ fetchFn, sleep: async () => {} });
  return { source, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const cell = { latE2: 4733, lonE2: -174 };

describe("OpenMeteoSource", () => {
  it("forecast : coordonnées arrondies, variables, fuseau et past_days dans l'URL", async () => {
    const { source, calls } = scripted([json(forecast)]);
    const days = await source.forecast(cell, 7);
    expect(days).toHaveLength(8);
    const url = new URL(calls[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("47.33");
    expect(url.searchParams.get("longitude")).toBe("-1.74");
    expect(url.searchParams.get("past_days")).toBe("7");
    expect(url.searchParams.get("timezone")).toBe("Europe/Paris");
    expect(url.searchParams.get("daily")).toContain("sunshine_duration");
    expect(url.searchParams.get("daily")).toContain("shortwave_radiation_sum");
  });

  it("hourly : rayonnement et température, heures en secondes UTC, jours demandés", async () => {
    const { source, calls } = scripted([json(hourly)]);
    const hours = await source.hourly(cell, 3);
    expect(hours).toHaveLength(4);
    const url = new URL(calls[0] ?? "");
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("hourly")).toBe("shortwave_radiation,temperature_2m");
    expect(url.searchParams.get("timeformat")).toBe("unixtime");
    expect(url.searchParams.get("timezone")).toBe("GMT");
    expect(url.searchParams.get("forecast_days")).toBe("3");
    expect(url.searchParams.get("latitude")).toBe("47.33");
  });

  it("archive : période demandée dans l'URL", async () => {
    const { source, calls } = scripted([json(forecast)]);
    await source.archive(cell, "2023-10-03", "2026-10-02");
    const url = new URL(calls[0] ?? "");
    expect(url.host).toBe("archive-api.open-meteo.com");
    expect(url.searchParams.get("start_date")).toBe("2023-10-03");
    expect(url.searchParams.get("end_date")).toBe("2026-10-02");
  });

  it("réessaie après une erreur réseau ou un 5xx, puis réussit", async () => {
    const { source, calls } = scripted([new Error("ECONNRESET"), json({}, 503), json(forecast)]);
    expect(await source.forecast(cell, 7)).toHaveLength(8);
    expect(calls).toHaveLength(3);
  });

  it("abandonne après 3 essais", async () => {
    const { source, calls } = scripted([json({}, 500), json({}, 500), json({}, 500)]);
    await expect(source.forecast(cell, 7)).rejects.toThrow("HTTP 500");
    expect(calls).toHaveLength(3);
  });

  it("ne réessaie pas une erreur 4xx", async () => {
    const { source, calls } = scripted([json({ error: true }, 400)]);
    await expect(source.forecast(cell, 7)).rejects.toThrow("HTTP 400");
    expect(calls).toHaveLength(1);
  });

  it("recherche de communes : françaises en tête", async () => {
    const { source, calls } = scripted([json(geocode)]);
    const results = await source.searchCommunes("Valence");
    expect(results[0]?.label).toBe("Valence (Drôme)");
    expect(new URL(calls[0] ?? "").searchParams.get("language")).toBe("fr");
  });
});
