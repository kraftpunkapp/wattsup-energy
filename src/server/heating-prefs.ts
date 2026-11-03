import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { household } from "@/db/schema";
import type { HouseholdContext } from "./context";

// Préférences de la page Chauffage, dans household.settings (aucune table de plus).

/** Vrai : l'invitation « Vous chauffez aussi au bois ? » a été écartée par le foyer. */
export const woodInvitationHidden = (ctx: HouseholdContext) =>
  ctx.settings.woodInvitationHidden === true;

/** Écarte ou réaffiche l'invitation à suivre le bois. */
export async function setWoodInvitationHidden(ctx: HouseholdContext, hidden: boolean) {
  await db
    .update(household)
    .set({
      settings: sql`${household.settings} || ${JSON.stringify({ woodInvitationHidden: hidden })}::jsonb`,
    })
    .where(eq(household.id, ctx.householdId));
}
