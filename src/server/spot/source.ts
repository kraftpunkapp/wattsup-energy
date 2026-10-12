import { hourlyAverages, type SpotHour } from "@/domain/spot";
import { httpClient, type HttpClient, type HttpOptions } from "../http";

// Prix spot EPEX France (T58) depuis energy-charts.info (Fraunhofer ISE), sans clé, données
// Bundesnetzagentur | SMARD.de sous licence CC BY 4.0. Aucune donnée utilisateur n'est
// envoyée : les appels ne portent que sur des dates.

export interface SpotSource {
  /** Moyennes horaires des jours [from, to] (AAAA-MM-JJ, fin incluse). */
  prices(from: string, to: string): Promise<SpotHour[]>;
}

const BASE = "https://api.energy-charts.info/price?bzn=FR";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class EnergyChartsSource implements SpotSource {
  private readonly http: HttpClient;

  constructor(options: HttpOptions = {}) {
    this.http = httpClient({ timeoutMs: 20_000, ...options });
  }

  async prices(from: string, to: string): Promise<SpotHour[]> {
    if (!DATE.test(from) || !DATE.test(to)) throw new Error(`période invalide : ${from}–${to}`);
    return hourlyAverages(await this.http.getJson(`${BASE}&start=${from}&end=${to}`));
  }
}
