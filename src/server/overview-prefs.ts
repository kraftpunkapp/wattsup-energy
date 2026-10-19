import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { household } from "@/db/schema";
import {
  applicableBlocks,
  hiddenBlocks,
  withBlockHidden,
  type OverviewBlock,
} from "@/domain/overview-blocks";
import { currentContract, latestGrid } from "@/domain/tariff/timeline";
import { localParts } from "@/lib/time";
import type { HouseholdContext } from "./context";
import { listContracts } from "./contracts";

// Vue d'ensemble personnalisable (T50) : blocs masqués, dans household.settings.overview.

export const overviewHidden = (ctx: HouseholdContext) => hiddenBlocks(ctx.settings.overview);

/** Masque ou réaffiche un bloc ; renvoie la nouvelle liste des blocs masqués. */
export async function setOverviewBlockHidden(
  ctx: HouseholdContext,
  block: OverviewBlock,
  hide: boolean,
): Promise<OverviewBlock[]> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ settings: household.settings })
      .from(household)
      .where(eq(household.id, ctx.householdId))
      .for("update");
    const hidden = withBlockHidden(hiddenBlocks(row?.settings.overview), block, hide);
    await tx
      .update(household)
      .set({
        settings: sql`${household.settings} || ${JSON.stringify({ overview: { hidden } })}::jsonb`,
      })
      .where(eq(household.id, ctx.householdId));
    return hidden;
  });
}

/** Blocs proposés dans Réglages › Vue d'ensemble pour ce foyer. */
export async function overviewBlocksFor(ctx: HouseholdContext, now = new Date()) {
  const contracts = await listContracts(ctx);
  const currentId = currentContract(contracts, localParts(now, ctx.timezone).date)?.id;
  const current = contracts.find((c) => c.id === currentId);
  return applicableBlocks({
    solar: ctx.profile.solar,
    granularity: ctx.granularity,
    contractKind: current ? latestGrid(current).kind : null,
    contracts: contracts.length,
    payment: Boolean(current?.payment),
  });
}
