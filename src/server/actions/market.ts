"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseMeterPower } from "@/domain/market/compare";
import { getHouseholdContext } from "../context";
import { ContractError } from "../contracts";
import { addMarketOffer } from "../market/compare";
import { updateMeterPower } from "../settings";

// Offres du marché sur la page Contrats (T55) : puissance du compteur et « Ajouter à mes
// offres ».

export type MarketActionResult = { ok: true } | { ok: false; errors: string[] };

export async function saveMeterPowerAction(kva: unknown): Promise<MarketActionResult> {
  const power = parseMeterPower(kva);
  if (power === null) return { ok: false, errors: ["puissance inconnue"] };
  const ctx = await getHouseholdContext();
  await updateMeterPower(ctx, power);
  revalidatePath("/contrats");
  return { ok: true };
}

const offerName = z.string().min(1).max(80);

export async function addMarketOfferAction(name: unknown): Promise<MarketActionResult> {
  const p = offerName.safeParse(name);
  if (!p.success) return { ok: false, errors: ["offre introuvable"] };
  const ctx = await getHouseholdContext();
  try {
    await addMarketOffer(ctx, p.data);
  } catch (err) {
    if (err instanceof ContractError) return { ok: false, errors: err.messages };
    throw err;
  }
  revalidatePath("/contrats");
  return { ok: true };
}
