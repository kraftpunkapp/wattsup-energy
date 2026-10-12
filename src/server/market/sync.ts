import { desc, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { marketImport, marketOffer, marketSync, sobrietyDay } from "@/db/schema";
import { findCallArguments } from "@/domain/market/literal";
import {
  describeOffer,
  diffCatalogs,
  parseManifest,
  parseSobrietyCalendar,
  parseSourceTariff,
  SOBRIETY_CALENDAR_PATH,
  type CatalogDiff,
  type SourceTariff,
} from "@/domain/market/offer";
import { shareInFlight } from "../inflight";
import { MANIFEST_PATH, type OfferSource } from "./source";

// Synchronisation du catalogue d'offres (SPEC §7.12) : le dernier commit de la source est
// vérifié chaque jour ; le catalogue n'est téléchargé que s'il a changé (ou à la demande de
// l'administrateur), puis remplacé en une transaction. Un échec laisse le catalogue
// précédent en place. Un seul import à la fois (planificateur et bouton partagent le calcul).

export const marketSyncEnabled = () => process.env.MARKET_SYNC !== "off";

const MAX_FILES = 200;
const CONCURRENCY = 4;
const KEEP_IMPORTS = 20;

export type MarketSyncResult =
  | { status: "unchanged"; commit: string }
  | ({ status: "imported"; commit: string; offers: number; compared: number } & CatalogDiff)
  | { status: "error"; error: string };

interface ReadOffer {
  name: string;
  sourcePath: string;
  definition: SourceTariff;
}

/** Lit le manifeste puis chaque fichier de tarif au commit `sha`. */
async function readCatalog(source: OfferSource, sha: string) {
  const paths = parseManifest(await source.file(sha, MANIFEST_PATH)).slice(0, MAX_FILES);
  const offers = new Map<string, ReadOffer>();
  const unreadable: string[] = [];
  const files = new Map<string, string>();
  for (let i = 0; i < paths.length; i += CONCURRENCY) {
    const batch = paths.slice(i, i + CONCURRENCY);
    const texts = await Promise.all(batch.map((p) => source.file(sha, p)));
    batch.forEach((p, j) => files.set(p, texts[j] as string));
  }
  for (const [path, text] of files) {
    for (const arg of findCallArguments(text, "defineTarif")) {
      const parsed = arg.ok
        ? parseSourceTariff(arg.value)
        : { ok: false as const, error: arg.error };
      if (!parsed.ok) {
        unreadable.push(`${path} : ${parsed.error}`);
      } else if (offers.has(parsed.tariff.name)) {
        unreadable.push(`${path} : « ${parsed.tariff.name} » en double, ignorée`);
      } else {
        offers.set(parsed.tariff.name, {
          name: parsed.tariff.name,
          sourcePath: path,
          definition: parsed.tariff,
        });
      }
    }
  }
  // Jours de sobriété Zen Flex (T57) : illisibles, le calendrier précédent reste en place.
  let sobriety: string[] | null = null;
  try {
    sobriety = parseSobrietyCalendar(await source.file(sha, SOBRIETY_CALENDAR_PATH));
  } catch (err) {
    unreadable.push(`${SOBRIETY_CALENDAR_PATH} : ${(err as Error).message}`);
  }
  return { offers: [...offers.values()], unreadable, sobriety };
}

async function saveState(values: Partial<typeof marketSync.$inferInsert>) {
  await db
    .insert(marketSync)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: marketSync.id, set: values });
}

async function run(source: OfferSource, force: boolean, now: Date): Promise<MarketSyncResult> {
  try {
    const commit = await source.latestCommit();
    const [state] = await db.select().from(marketSync);
    // Commit inchangé : rien à relire, sauf si le calendrier Zen Flex n'a jamais été importé
    // (instance mise à jour après le dernier import du catalogue).
    if (!force && state?.sourceCommit === commit.sha && (await db.$count(sobrietyDay)) > 0) {
      await saveState({ checkedAt: now, status: "ok", error: null });
      return { status: "unchanged", commit: commit.sha };
    }

    const { offers, unreadable, sobriety } = await readCatalog(source, commit.sha);
    if (offers.length === 0) throw new Error("aucune offre lisible dans le catalogue");
    const compared = offers.filter(
      (o) => describeOffer(o.definition).support.status === "compared",
    ).length;

    const diff = await db.transaction(async (tx) => {
      const previous = await tx.select().from(marketOffer);
      const firstSeen = new Map(previous.map((o) => [o.name, o.firstSeenAt]));
      // Premier import : rien n'est « nouveau », tout le catalogue est la référence.
      const diff =
        previous.length === 0
          ? { added: [], removed: [], updated: [] }
          : diffCatalogs(previous, offers);
      await tx.delete(marketOffer);
      await tx.insert(marketOffer).values(
        offers.map((o) => ({
          ...o,
          firstSeenAt: firstSeen.get(o.name) ?? now,
          importedAt: now,
        })),
      );
      if (sobriety) {
        await tx.delete(sobrietyDay);
        if (sobriety.length > 0) {
          await tx.insert(sobrietyDay).values(sobriety.map((date) => ({ date, importedAt: now })));
        }
      }
      await tx.insert(marketImport).values({
        at: now,
        sourceCommit: commit.sha,
        offers: offers.length,
        compared,
        ...diff,
        unreadable,
      });
      const kept = tx
        .select({ id: marketImport.id })
        .from(marketImport)
        .orderBy(desc(marketImport.at))
        .limit(KEEP_IMPORTS);
      await tx.delete(marketImport).where(notInArray(marketImport.id, kept));
      const state = {
        sourceCommit: commit.sha,
        sourceCommittedAt: commit.date,
        checkedAt: now,
        importedAt: now,
        status: "ok" as const,
        error: null,
      };
      await tx
        .insert(marketSync)
        .values({ id: 1, ...state })
        .onConflictDoUpdate({ target: marketSync.id, set: state });
      return diff;
    });
    return { status: "imported", commit: commit.sha, offers: offers.length, compared, ...diff };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await saveState({ checkedAt: now, status: "error", error: error.slice(0, 500) });
    return { status: "error", error };
  }
}

/** Vérifie la source et importe le catalogue s'il a changé (`force` : importe quand même). */
export function syncMarket(
  source: OfferSource,
  { force = false, now = new Date() }: { force?: boolean; now?: Date } = {},
): Promise<MarketSyncResult> {
  return shareInFlight("market-sync", () => run(source, force, now));
}
