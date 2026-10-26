import {
  cellCoordinates,
  DAILY_VARIABLES,
  HOURLY_VARIABLES,
  parseOpenMeteoHourly,
  parseGeocoding,
  parseOpenMeteoDaily,
  type Cell,
  type CommuneResult,
  type WeatherDay,
  type WeatherHour,
} from "@/domain/weather";
import { httpClient, type HttpClient, type HttpOptions } from "../http";

// Client Open-Meteo (SPEC §7.9) : gratuit en usage non commercial, sans clé. Seules
// les coordonnées arrondies de la maille sont envoyées, jamais d'identifiant.

export interface WeatherSource {
  /** Les `pastDays` derniers jours et aujourd'hui (modèle de prévision). */
  forecast(cell: Cell, pastDays: number): Promise<WeatherDay[]>;
  /** Réanalyse ERA5, jours [from, to] inclus. */
  archive(cell: Cell, from: string, to: string): Promise<WeatherDay[]>;
  searchCommunes(query: string): Promise<CommuneResult[]>;
}

/** Météo heure par heure (T67–T68, SPEC §7.14) : passé récent et prévision. */
export interface HourlyForecastSource {
  /** Les `pastDays` derniers jours et les `days` prochains jours UTC, aujourd'hui compris. */
  hourly(cell: Cell, days: number, pastDays: number): Promise<WeatherHour[]>;
}

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";

export class OpenMeteoSource implements WeatherSource, HourlyForecastSource {
  private readonly http: HttpClient;

  constructor(options: HttpOptions = {}) {
    this.http = httpClient(options);
  }

  async forecast(cell: Cell, pastDays: number): Promise<WeatherDay[]> {
    const url = this.dailyUrl(FORECAST_URL, cell, {
      past_days: String(pastDays),
      forecast_days: "1",
    });
    return parseOpenMeteoDaily(await this.http.getJson(url));
  }

  async hourly(cell: Cell, days: number, pastDays: number): Promise<WeatherHour[]> {
    const { lat, lon } = cellCoordinates(cell);
    // Heures en secondes UTC : pas d'ambiguïté au changement d'heure.
    const params = new URLSearchParams({
      latitude: lat.toFixed(2),
      longitude: lon.toFixed(2),
      hourly: HOURLY_VARIABLES.join(","),
      timezone: "GMT",
      timeformat: "unixtime",
      forecast_days: String(days),
      past_days: String(pastDays),
    });
    return parseOpenMeteoHourly(await this.http.getJson(`${FORECAST_URL}?${params}`));
  }

  async archive(cell: Cell, from: string, to: string): Promise<WeatherDay[]> {
    const url = this.dailyUrl(ARCHIVE_URL, cell, { start_date: from, end_date: to });
    return parseOpenMeteoDaily(await this.http.getJson(url));
  }

  async searchCommunes(query: string): Promise<CommuneResult[]> {
    const params = new URLSearchParams({ name: query, count: "8", language: "fr", format: "json" });
    return parseGeocoding(await this.http.getJson(`${GEOCODING_URL}?${params}`));
  }

  private dailyUrl(base: string, cell: Cell, extra: Record<string, string>): string {
    const { lat, lon } = cellCoordinates(cell);
    const params = new URLSearchParams({
      latitude: lat.toFixed(2),
      longitude: lon.toFixed(2),
      daily: DAILY_VARIABLES.join(","),
      timezone: "Europe/Paris",
      ...extra,
    });
    return `${base}?${params}`;
  }
}
