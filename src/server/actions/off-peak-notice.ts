"use server";

import { revalidatePath } from "next/cache";
import { getHouseholdContext } from "../context";
import { hideOffPeakNotice } from "../off-peak-notice";

/** « Masquer » sur l'encart des heures creuses : retenu pour tout le foyer. */
export async function hideOffPeakNoticeAction(): Promise<{ ok: boolean }> {
  const ctx = await getHouseholdContext();
  await hideOffPeakNotice(ctx);
  revalidatePath("/");
  revalidatePath("/contrats");
  return { ok: true };
}
