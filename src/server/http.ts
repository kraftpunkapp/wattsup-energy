// GET vers les API publiques (Open-Meteo, Tempo, catalogue d'offres, prix spot) : timeout,
// nouvel essai sur erreur réseau ou 5xx avec backoff (0,5 s, 1 s…), sur 429 après 5 s puis
// 10 s, jamais sur les autres 4xx. fetch et la
// temporisation sont injectables pour les tests.

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retries?: number;
}

export interface HttpClient {
  getJson(url: string, headers?: Record<string, string>): Promise<unknown>;
  /** Texte de la réponse, refusé au-delà de `maxBytes` octets. */
  getText(url: string, maxBytes: number): Promise<string>;
}

export function httpClient(options: HttpOptions = {}): HttpClient {
  const fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 3;

  async function get<T>(
    url: string,
    headers: Record<string, string>,
    read: (res: Response) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
      try {
        const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers });
        if (res.ok) return await read(res);
        lastError = new Error(`HTTP ${res.status} sur ${new URL(url).host}`);
        // Trop de requêtes : on attend plus longtemps avant de réessayer (5 s, 10 s…).
        if (res.status === 429) {
          if (attempt < retries - 1) await sleep(5000 * (attempt + 1));
          continue;
        }
        if (res.status < 500) break; // une autre erreur 4xx ne se corrige pas en réessayant
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return {
    getJson: (url, headers = {}) =>
      get(url, { accept: "application/json", ...headers }, (res) => res.json()),
    getText: (url, maxBytes) =>
      get(url, {}, async (res) => {
        const text = await res.text();
        if (Buffer.byteLength(text) > maxBytes) {
          throw new Error(`réponse trop volumineuse sur ${new URL(url).host}`);
        }
        return text;
      }),
  };
}
