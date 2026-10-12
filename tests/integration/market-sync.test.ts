import { readFileSync } from "node:fs";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { marketImport, marketOffer, marketSync, sobrietyDay, user } from "@/db/schema";
import { ForbiddenError } from "@/server/admin";
import { getMarketCatalog } from "@/server/market/catalog";
import { MANIFEST_PATH, type OfferSource } from "@/server/market/source";
import { syncMarket } from "@/server/market/sync";
import { createTestHousehold } from "../helpers/tenancy";

// Catalogue d'offres (SPEC §7.12) : source simulée à partir des fichiers réels des
// fixtures, servis à un commit donné.

const ROOT = join(__dirname, "../fixtures/market");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

const BLEU = "scripts/tarifs/edf/bleu.js";
const TEMPO = "scripts/tarifs/edf/tempo.js";
const ESTIVAL = "scripts/tarifs/edf/zenEstival.js";
const EJP = "scripts/tarifs/edf/ejp.js";
const manifest = (paths: string[]) =>
  `export const TARIF_SCRIPTS = [\n${paths.map((p) => `  "${p}",`).join("\n")}\n];`;

function fakeSource(init: { sha: string; files: Record<string, string> }) {
  const state = { ...init, calls: [] as string[], fail: null as Error | null };
  const source: OfferSource = {
    latestCommit: async () => {
      state.calls.push("commit");
      if (state.fail) throw state.fail;
      return { sha: state.sha, date: new Date("2026-10-02T11:22:00Z") };
    },
    file: async (sha, path) => {
      state.calls.push(path);
      expect(sha).toBe(state.sha);
      const text = state.files[path];
      if (text === undefined) throw new Error(`HTTP 404 sur raw.githubusercontent.com`);
      return text;
    },
  };
  return { source, state };
}

const CALENDAR = "scripts/tarifs-lib/calendars/zenflex-sobriete.js";
const files = (paths: string[], overrides: Record<string, string> = {}) => ({
  [MANIFEST_PATH]: manifest(paths),
  [CALENDAR]: read(CALENDAR),
  ...Object.fromEntries(paths.map((p) => [p, read(p)])),
  ...overrides,
});

beforeEach(async () => {
  await db.delete(sobrietyDay);
  await db.delete(marketOffer);
  await db.delete(marketImport);
  await db.delete(marketSync);
});

const names = async () =>
  (await db.select({ name: marketOffer.name }).from(marketOffer)).map((r) => r.name).sort();

describe("synchronisation du catalogue", () => {
  const t0 = new Date("2026-10-12T02:00:00Z");

  it("premier import : toutes les offres, rien de « nouveau »", async () => {
    const { source } = fakeSource({ sha: SHA_A, files: files([BLEU, TEMPO, EJP]) });
    const r = await syncMarket(source, { now: t0 });
    expect(r).toMatchObject({ status: "imported", offers: 4, compared: 3, added: [] });
    expect(await names()).toEqual([
      "EDF - Bleu",
      "EDF - Bleu Heures Creuses",
      "EDF - EJP",
      "EDF - Tempo",
    ]);
    const [state] = await db.select().from(marketSync);
    expect(state).toMatchObject({ sourceCommit: SHA_A, status: "ok", error: null });
    expect(await db.$count(marketImport)).toBe(1);
  });

  it("commit inchangé : une seule requête, rien n'est relu", async () => {
    const { source, state } = fakeSource({ sha: SHA_A, files: files([BLEU]) });
    await syncMarket(source, { now: t0 });
    state.calls = [];
    const later = new Date("2026-10-13T02:00:00Z");
    expect(await syncMarket(source, { now: later })).toEqual({
      status: "unchanged",
      commit: SHA_A,
    });
    expect(state.calls).toEqual(["commit"]);
    const [row] = await db.select().from(marketSync);
    expect(row?.checkedAt).toEqual(later);
    expect(await db.$count(marketImport)).toBe(1);
  });

  it("import forcé même si le commit est inchangé", async () => {
    const { source } = fakeSource({ sha: SHA_A, files: files([BLEU]) });
    await syncMarket(source, { now: t0 });
    expect(await syncMarket(source, { force: true, now: t0 })).toMatchObject({
      status: "imported",
    });
    expect(await db.$count(marketImport)).toBe(2);
  });

  it("nouveau commit : nouvelles, retirées, modifiées ; première apparition conservée", async () => {
    const { source, state } = fakeSource({ sha: SHA_A, files: files([BLEU, ESTIVAL]) });
    await syncMarket(source, { now: t0 });
    state.sha = SHA_B;
    state.files = files([BLEU, TEMPO], {
      [BLEU]: read(BLEU).replace("price: 19.85", "price: 19.99"),
    });
    const t1 = new Date("2026-11-01T03:00:00Z");
    const r = await syncMarket(source, { now: t1 });
    expect(r).toMatchObject({
      status: "imported",
      added: ["EDF - Tempo"],
      removed: ["EDF - Zen Estival"],
      updated: ["EDF - Bleu"],
    });
    const rows = await db.select().from(marketOffer);
    const seen = Object.fromEntries(rows.map((o) => [o.name, o.firstSeenAt.toISOString()]));
    expect(seen["EDF - Bleu"]).toBe(t0.toISOString());
    expect(seen["EDF - Tempo"]).toBe(t1.toISOString());
  });

  it("une définition illisible est signalée sans bloquer les autres", async () => {
    const bad = "scripts/tarifs/x/bad.js";
    const { source } = fakeSource({
      sha: SHA_A,
      files: {
        ...files([BLEU]),
        [MANIFEST_PATH]: manifest([BLEU, bad]),
        [bad]: "defineTarif({ name: compute() });",
      },
    });
    const r = await syncMarket(source, { now: t0 });
    expect(r).toMatchObject({ status: "imported", offers: 2 });
    const [imp] = await db.select().from(marketImport);
    expect(imp?.unreadable).toEqual([expect.stringContaining("scripts/tarifs/x/bad.js")]);
  });

  it("échec : le catalogue précédent reste en place et l'erreur est notée", async () => {
    const { source, state } = fakeSource({ sha: SHA_A, files: files([BLEU]) });
    await syncMarket(source, { now: t0 });
    state.sha = SHA_B;
    state.files = { [MANIFEST_PATH]: manifest([BLEU, TEMPO]), [BLEU]: read(BLEU) }; // TEMPO 404
    const r = await syncMarket(source, { now: t0 });
    expect(r).toMatchObject({ status: "error", error: expect.stringContaining("404") });
    expect(await names()).toEqual(["EDF - Bleu", "EDF - Bleu Heures Creuses"]);
    const [row] = await db.select().from(marketSync);
    expect(row).toMatchObject({ sourceCommit: SHA_A, status: "error" });

    state.fail = new Error("réseau indisponible");
    expect(await syncMarket(source, { now: t0 })).toMatchObject({ status: "error" });
    expect(await names()).toHaveLength(2);
  });

  it("un catalogue vide n'efface rien", async () => {
    const { source, state } = fakeSource({ sha: SHA_A, files: files([BLEU]) });
    await syncMarket(source, { now: t0 });
    state.sha = SHA_B;
    state.files = { [MANIFEST_PATH]: manifest([]) };
    expect(await syncMarket(source, { now: t0 })).toMatchObject({ status: "error" });
    expect(await names()).toHaveLength(2);
  });
});

describe("jours de sobriété Zen Flex (T57)", () => {
  it("commit inchangé mais calendrier jamais importé : le catalogue est relu", async () => {
    const { source } = fakeSource({ sha: SHA_A, files: files([BLEU]) });
    await syncMarket(source);
    await db.delete(sobrietyDay);
    expect(await syncMarket(source)).toMatchObject({ status: "imported" });
    expect(await db.$count(sobrietyDay)).toBeGreaterThan(100);
    expect(await syncMarket(source)).toMatchObject({ status: "unchanged" });
  });

  it("importés avec le catalogue ; un calendrier illisible garde le précédent", async () => {
    const { source, state } = fakeSource({ sha: SHA_A, files: files([BLEU]) });
    await syncMarket(source);
    const count = await db.$count(sobrietyDay);
    expect(count).toBeGreaterThan(100);
    state.sha = SHA_B;
    state.files = files([BLEU], { [CALENDAR]: 'defineCalendar("zenflex-sobriete", 42);' });
    expect(await syncMarket(source)).toMatchObject({ status: "imported" });
    expect(await db.$count(sobrietyDay)).toBe(count);
    const [imp] = await db.select().from(marketImport).orderBy(desc(marketImport.at)).limit(1);
    expect(imp?.unreadable).toEqual([expect.stringContaining("zenflex-sobriete.js")]);
  });
});

describe("lecture pour l'administration", () => {
  it("réservée à l'administrateur ; statut recalculé à la lecture", async () => {
    const { source } = fakeSource({ sha: SHA_A, files: files([TEMPO, EJP]) });
    await syncMarket(source);
    const member = await createTestHousehold("market-member");
    await expect(getMarketCatalog(member)).rejects.toThrow(ForbiddenError);

    const base = await createTestHousehold("market-admin");
    await db.update(user).set({ isAdmin: true }).where(eq(user.id, base.userId));
    const catalog = await getMarketCatalog({ ...base, isAdmin: true });
    expect(catalog.state?.sourceCommit).toBe(SHA_A);
    expect(catalog.offers.map((o) => [o.name, o.support.status])).toEqual([
      ["EDF - EJP", "never"],
      ["EDF - Tempo", "compared"],
    ]);
    expect(catalog.offers[1]).toMatchObject({ provider: "EDF", regulated: true });
    expect(catalog.offers[1]?.priceUrl).toMatch(/^https:\/\/particulier\.edf\.fr\//);
  });
});
