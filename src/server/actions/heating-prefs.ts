"use server";

import { revalidatePath } from "next/cache";
import { getHouseholdContext } from "../context";
import { setWoodInvitationHidden } from "../heating-prefs";

/** « Non, masquer » sur l'invitation à suivre le bois : retenu pour tout le foyer. */
export async function hideWoodInvitationAction(): Promise<{ ok: boolean }> {
  const ctx = await getHouseholdContext();
  await setWoodInvitationHidden(ctx, true);
  revalidatePath("/chauffage");
  return { ok: true };
}
