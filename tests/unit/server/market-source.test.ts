import { describe, expect, it } from "vitest";
import { GitHubOfferSource } from "@/server/market/source";

// Source du catalogue d'offres : dernier commit sur api.github.com, fichiers lus au commit
// sur raw.githubusercontent.com ; aucun autre hôte, aucun chemin hors du dépôt.

const SHA = "b86f709f95a3c2931050c807867ff8bed2a33b21";

function source(respond: (url: string) => Response) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const s = new GitHubOfferSource({
    fetchFn: async (url, init) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return respond(url);
    },
    sleep: async () => {},
  });
  return { s, calls };
}

describe("GitHubOfferSource", () => {
  it("lit le dernier commit de la branche principale", async () => {
    const { s, calls } = source(
      () =>
        new Response(
          JSON.stringify({ sha: SHA, commit: { committer: { date: "2026-10-02T11:22:21Z" } } }),
        ),
    );
    expect(await s.latestCommit()).toEqual({ sha: SHA, date: new Date("2026-10-02T11:22:21Z") });
    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/JC144/EDF_Simulateur_Prix/commits/main",
    );
    expect(calls[0]?.headers["user-agent"]).toBe("WattsUp-Energy");
  });

  it("refuse une réponse inattendue", async () => {
    const { s } = source(() => new Response(JSON.stringify({ sha: "x" })));
    await expect(s.latestCommit()).rejects.toThrow(/inattendue/);
  });

  it("lit un fichier au commit donné", async () => {
    const { s, calls } = source(() => new Response("defineTarif({})"));
    expect(await s.file(SHA, "scripts/tarifs/edf/tempo.js")).toBe("defineTarif({})");
    expect(calls[0]?.url).toBe(
      `https://raw.githubusercontent.com/JC144/EDF_Simulateur_Prix/${SHA}/scripts/tarifs/edf/tempo.js`,
    );
  });

  it("refuse un chemin ou un commit douteux, sans appel réseau", async () => {
    const { s, calls } = source(() => new Response(""));
    await expect(s.file(SHA, "../../etc/passwd.js")).rejects.toThrow(/refusé/);
    await expect(s.file("main", "scripts/tarifs/a/b.js")).rejects.toThrow(/refusé/);
    expect(calls).toHaveLength(0);
  });

  it("refuse un fichier trop volumineux", async () => {
    const { s } = source(() => new Response("x".repeat(600 * 1024)));
    await expect(s.file(SHA, "scripts/tarifs/a/b.js")).rejects.toThrow(/volumineuse/);
  });
});
