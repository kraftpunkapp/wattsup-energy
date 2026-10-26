"use server";

import { revalidatePath } from "next/cache";
import { parseAppliance } from "@/domain/forecast/appliances";
import { deleteAppliance, saveAppliance } from "../appliances";
import { getHouseholdContext } from "../context";
import { ContractError } from "../contracts";

// Appareils déplaçables (T71) : Réglages › Appareils.

export type ApplianceActionResult = { ok: true } | { ok: false; errors: string[] };

async function run(fn: () => Promise<unknown>): Promise<ApplianceActionResult> {
  try {
    const result = await fn();
    revalidatePath("/reglages");
    revalidatePath("/previsions");
    revalidatePath("/");
    return result === null || result === false
      ? { ok: false, errors: ["appareil introuvable"] }
      : { ok: true };
  } catch (err) {
    if (err instanceof ContractError) return { ok: false, errors: err.messages };
    throw err;
  }
}

export async function saveApplianceAction(
  id: string | null,
  input: unknown,
): Promise<ApplianceActionResult> {
  const parsed = parseAppliance(input);
  if (!parsed.ok) return parsed;
  const ctx = await getHouseholdContext();
  return run(() => saveAppliance(ctx, id, parsed.value));
}

export async function deleteApplianceAction(id: string): Promise<ApplianceActionResult> {
  const ctx = await getHouseholdContext();
  return run(() => deleteAppliance(ctx, id));
}
