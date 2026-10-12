import { z } from "zod";
import { httpClient, type HttpClient, type HttpOptions } from "../http";

// Source du catalogue d'offres (SPEC §7.12) : le dépôt public JC144/EDF_Simulateur_Prix
// (GPL-3.0), qui alimente comparateur-abonnements-electricite.fr. Aucune donnée
// utilisateur n'est envoyée : les appels ne portent que sur le dernier commit et sur les
// fichiers du dépôt, lus à ce commit pour un catalogue cohérent.

export const SOURCE_REPO = "JC144/EDF_Simulateur_Prix";
export const MANIFEST_PATH = "scripts/tarifs-manifest.js";

export interface SourceCommit {
  sha: string;
  date: Date | null;
}

export interface OfferSource {
  latestCommit(): Promise<SourceCommit>;
  /** Contenu d'un fichier du dépôt au commit donné. */
  file(sha: string, path: string): Promise<string>;
}

const MAX_FILE_BYTES = 512 * 1024;
const commitSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  commit: z.object({ committer: z.object({ date: z.string() }).nullable() }),
});

export class GitHubOfferSource implements OfferSource {
  private readonly http: HttpClient;

  constructor(options: HttpOptions = {}) {
    this.http = httpClient(options);
  }

  async latestCommit(): Promise<SourceCommit> {
    const body = await this.http.getJson(
      `https://api.github.com/repos/${SOURCE_REPO}/commits/main`,
      {
        accept: "application/vnd.github+json",
        "user-agent": "WattsUp-Energy",
      },
    );
    const r = commitSchema.safeParse(body);
    if (!r.success) throw new Error("réponse de GitHub inattendue");
    const date = r.data.commit.committer ? new Date(r.data.commit.committer.date) : null;
    return { sha: r.data.sha, date: date && !Number.isNaN(date.getTime()) ? date : null };
  }

  async file(sha: string, path: string): Promise<string> {
    if (!/^[0-9a-f]{40}$/.test(sha) || !/^[A-Za-z0-9_/-]+\.js$/.test(path) || path.includes("..")) {
      throw new Error(`fichier refusé : ${path}`);
    }
    return this.http.getText(
      `https://raw.githubusercontent.com/${SOURCE_REPO}/${sha}/${path}`,
      MAX_FILE_BYTES,
    );
  }
}
