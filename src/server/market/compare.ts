import { eq } from "drizzle-orm";
import { db } from "@/db";
import { household, marketOffer, marketSync, user } from "@/db/schema";
import {
  compareMarket,
  householdOffPeak,
  parseMeterPower,
  type MarketComparison,
} from "@/domain/market/compare";
import { fingerprint, marketContractName, toContract } from "@/domain/market/offer";
import type { HouseholdContext } from "../context";
import { householdContextFor } from "../context";
import { ContractError, createContract, listContracts } from "../contracts";
import { comparisonInputs } from "../queries/contracts";

// Offres du marché sur la page Contrats (SPEC §7.12) : le catalogue rejoué sur la
// consommation du foyer. Le résultat est gardé en mémoire par foyer tant que le catalogue,
// la puissance, le contrat actuel et la consommation des 12 derniers mois n'ont pas changé ;
// l'alerte « offre plus avantageuse » lit ce résultat sans recalculer.

export type MarketOffers =
  | { status: "no-catalog" }
  | { status: "no-power" }
  | { status: "no-data" }
  | ({ status: "ok"; kva: number; catalogDate: Date | null } & MarketComparison);

interface Memo {
  key: string;
  value: Extract<MarketOffers, { status: "ok" }>;
}
const memo = new Map<string, Memo>();

export async function getMarketOffers(
  ctx: HouseholdContext,
  now = new Date(),
): Promise<MarketOffers> {
  const kva = parseMeterPower(ctx.settings.meterPowerKva);
  const [[state], offers] = await Promise.all([
    db.select().from(marketSync),
    db.select({ name: marketOffer.name, definition: marketOffer.definition }).from(marketOffer),
  ]);
  if (offers.length === 0) return { status: "no-catalog" };
  if (kva === null) return { status: "no-power" };
  const inputs = await comparisonInputs(ctx, now);
  if (inputs.status !== "ok") return { status: "no-data" };

  const current = inputs.current?.contract ?? null;
  const kwh = inputs.intervals.reduce((a, i) => a + i.kwh, 0);
  const key = [
    state?.importedAt?.toISOString() ?? "",
    kva,
    inputs.from,
    inputs.today,
    inputs.intervals.length,
    kwh.toFixed(3),
    inputs.colors.size,
    current ? fingerprint(current) : "",
  ].join("|");
  const cached = memo.get(ctx.householdId);
  if (cached?.key === key) return cached.value;

  const value = {
    status: "ok" as const,
    kva,
    catalogDate: state?.sourceCommittedAt ?? state?.importedAt ?? null,
    ...compareMarket(offers, kva, current, inputs.intervals, inputs.pricing, inputs.periodDays),
  };
  memo.set(ctx.householdId, { key, value });
  return value;
}

/** Meilleure économie connue (calcul déjà fait) ; null si rien n'a été calculé. */
export function knownMarketSaving(
  householdId: string,
): { name: string; savingCents: number } | null {
  const best = memo.get(householdId)?.value.rows[0];
  if (!best || best.deltaAnnualCents === null || best.deltaAnnualCents >= 0) return null;
  return { name: best.name, savingCents: -best.deltaAnnualCents };
}

/**
 * Tâche du planificateur (après l'import du catalogue) : calcule les offres du marché de
 * chaque foyer qui a renseigné sa puissance, pour que l'alerte parte sans visite de la page.
 */
export async function refreshMarketOffersForAll(): Promise<{ households: number }> {
  const rows = await db
    .select({
      ownerId: household.ownerId,
      settings: household.settings,
      name: user.name,
      email: user.email,
      disabledAt: user.disabledAt,
    })
    .from(household)
    .innerJoin(user, eq(user.id, household.ownerId));
  const wanted = rows.filter((r) => !r.disabledAt && parseMeterPower(r.settings.meterPowerKva));
  for (const r of wanted) {
    try {
      await getMarketOffers(await householdContextFor(r.ownerId, r.name, r.email));
    } catch (err) {
      console.error("[offres] calcul impossible pour un foyer :", err);
    }
  }
  return { households: wanted.length };
}

/**
 * « Ajouter à mes offres » : copie simulée de l'offre, à la puissance du foyer et avec ses
 * plages creuses, modifiable ensuite comme n'importe quel contrat. Refus métier en français.
 */
export async function addMarketOffer(
  ctx: HouseholdContext,
  name: string,
  chosenDay: number | null = null,
) {
  const kva = parseMeterPower(ctx.settings.meterPowerKva);
  if (kva === null) throw new ContractError(["indiquez d'abord la puissance du compteur"]);
  const [row] = await db.select().from(marketOffer).where(eq(marketOffer.name, name));
  if (!row) throw new ContractError(["offre introuvable"]);
  const inputs = await comparisonInputs(ctx);
  const current = inputs.status === "ok" ? (inputs.current?.contract ?? null) : null;
  const built = toContract(row.definition, kva, householdOffPeak(current), chosenDay ?? undefined);
  if (!built) throw new ContractError([`offre non proposée en ${kva} kVA`]);
  const contractName = marketContractName(row.name, chosenDay);
  if ((await listContracts(ctx)).some((c) => c.name === contractName)) {
    throw new ContractError(["cette offre est déjà dans vos offres"]);
  }
  return createContract(ctx, { name: contractName, contract: built.contract, subscription: null });
}
