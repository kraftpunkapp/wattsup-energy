import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { household } from "@/db/schema";
import { needsOffPeakCheck } from "@/domain/tariff/off-peak";
import { currentContract, gridAt } from "@/domain/tariff/timeline";
import { localParts } from "@/lib/time";
import type { HouseholdContext } from "./context";
import { listContracts } from "./contracts";

// Encart « Vérifiez vos horaires » (T80), masquage retenu dans household.settings.

export async function showOffPeakNotice(ctx: HouseholdContext, now = new Date()) {
  if (ctx.settings.offPeakNoticeHidden === true) return false;
  const today = localParts(now, ctx.timezone).date;
  const contracts = await listContracts(ctx);
  const currentId = currentContract(contracts, today)?.id;
  const current = contracts.find((c) => c.id === currentId);
  return needsOffPeakCheck(current ? gridAt(current, today) : null);
}

export async function hideOffPeakNotice(ctx: HouseholdContext) {
  await db
    .update(household)
    .set({
      settings: sql`${household.settings} || ${JSON.stringify({ offPeakNoticeHidden: true })}::jsonb`,
    })
    .where(eq(household.id, ctx.householdId));
}
