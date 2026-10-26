import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { shiftableAppliance } from "@/db/schema";
import {
  MAX_APPLIANCES,
  type ApplianceIcon,
  type ApplianceInput,
} from "@/domain/forecast/appliances";
import type { HouseholdContext } from "./context";
import { ContractError } from "./contracts";

// Appareils déplaçables du foyer (T71, SPEC §7.14). Toutes les opérations filtrent par
// ctx.householdId : un id d'un autre foyer se comporte comme un id inconnu.

export interface ApplianceItem extends ApplianceInput {
  id: string;
}

export async function listAppliances(ctx: HouseholdContext): Promise<ApplianceItem[]> {
  const rows = await db
    .select()
    .from(shiftableAppliance)
    .where(eq(shiftableAppliance.householdId, ctx.householdId))
    .orderBy(asc(shiftableAppliance.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    icon: r.icon as ApplianceIcon,
    powerKw: r.powerKw,
    durationMin: r.durationMin,
    allowedFrom: r.allowedFrom,
    allowedTo: r.allowedTo,
  }));
}

/** Crée (id null) ou modifie un appareil ; null si l'id n'est pas à ce foyer. */
export async function saveAppliance(
  ctx: HouseholdContext,
  id: string | null,
  input: ApplianceInput,
) {
  if (id === null) {
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(shiftableAppliance)
      .where(eq(shiftableAppliance.householdId, ctx.householdId));
    if (n >= MAX_APPLIANCES) {
      throw new ContractError([`${MAX_APPLIANCES} appareils au plus`]);
    }
    const [row] = await db
      .insert(shiftableAppliance)
      .values({ householdId: ctx.householdId, ...input })
      .returning();
    return row ?? null;
  }
  const [row] = await db
    .update(shiftableAppliance)
    .set(input)
    .where(and(eq(shiftableAppliance.id, id), eq(shiftableAppliance.householdId, ctx.householdId)))
    .returning();
  return row ?? null;
}

export async function deleteAppliance(ctx: HouseholdContext, id: string): Promise<boolean> {
  const rows = await db
    .delete(shiftableAppliance)
    .where(and(eq(shiftableAppliance.id, id), eq(shiftableAppliance.householdId, ctx.householdId)))
    .returning({ id: shiftableAppliance.id });
  return rows.length > 0;
}
