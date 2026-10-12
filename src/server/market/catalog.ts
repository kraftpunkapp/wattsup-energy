import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { marketImport, marketOffer, marketSync } from "@/db/schema";
import { describeOffer, type OfferInfo } from "@/domain/market/offer";
import { requireAdmin } from "../admin";
import type { HouseholdContext } from "../context";

// Lecture du catalogue d'offres pour Administration › Offres du marché (SPEC §7.12). Le
// statut de chaque offre (comparée ou non, et pourquoi) est recalculé à la lecture.

export interface CatalogOffer extends OfferInfo {
  name: string;
  priceUrl: string | null;
  subscriptionUrl: string | null;
  firstSeenAt: Date;
}

export async function getMarketCatalog(ctx: HouseholdContext) {
  requireAdmin(ctx);
  const [[state], rows, imports] = await Promise.all([
    db.select().from(marketSync),
    db.select().from(marketOffer).orderBy(asc(marketOffer.name)),
    db.select().from(marketImport).orderBy(desc(marketImport.at)),
  ]);
  const offers: CatalogOffer[] = rows.map((r) => ({
    name: r.name,
    ...describeOffer(r.definition),
    priceUrl: r.definition.price_url || null,
    subscriptionUrl: r.definition.subscription_url || null,
    firstSeenAt: r.firstSeenAt,
  }));
  return { state: state ?? null, offers, imports };
}
