"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getHouseholdContext } from "../context";
import { updateFuelSettings, updateTomorrowNotice } from "../settings";

export type SettingsActionResult = { ok: true } | { ok: false; errors: string[] };

const monthDay = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "date de saison attendue (MM-JJ)");

const fuelSettings = z.object({
  pelletBagKg: z.number("poids du sac attendu").min(1, "poids du sac : 1 kg au moins").max(50),
  pelletBagsPerPallet: z.number().int("sacs par palette : nombre entier").min(1).max(200),
  heatingSeason: z.object({ from: monthDay, to: monthDay }),
  kwhFactors: z.object({
    pelletPerKg: z.number().min(1, "équivalence granulés : entre 1 et 10 kWh/kg").max(10),
    woodPerStere: z.number().min(300, "équivalence bois : entre 300 et 3 000 kWh/stère").max(3000),
  }),
});

export async function updateFuelSettingsAction(input: unknown): Promise<SettingsActionResult> {
  const p = fuelSettings.safeParse(input);
  if (!p.success) return { ok: false, errors: p.error.issues.map((i) => i.message) };
  const ctx = await getHouseholdContext();
  await updateFuelSettings(ctx, p.data);
  revalidatePath("/", "layout");
  return { ok: true };
}

const tomorrowNotice = z.object({ enabled: z.boolean(), email: z.boolean() });

/** Réglages › Alertes : notification du soir « Créneaux de demain » (T74). */
export async function saveTomorrowNoticeAction(input: unknown): Promise<SettingsActionResult> {
  const p = tomorrowNotice.safeParse(input);
  if (!p.success) return { ok: false, errors: ["réglage invalide"] };
  const ctx = await getHouseholdContext();
  await updateTomorrowNotice(ctx, p.data);
  revalidatePath("/reglages");
  return { ok: true };
}
