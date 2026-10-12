"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseContractInput } from "@/domain/tariff/schema";
import { setManualSobriety } from "../calendars";
import { getHouseholdContext } from "../context";
import {
  addPricePeriod,
  ContractError,
  createContract,
  deleteContract,
  deletePricePeriod,
  duplicateContract,
  switchContract,
  updateContract,
  updatePricePeriod,
} from "../contracts";
import { setManualTempoColor } from "../tempo/sync";

export type ActionResult = { ok: true } | { ok: false; errors: string[] };

const day = z.iso.date("date attendue");
const subscriptionSchema = z
  .object({ startDate: day, endDate: day.nullable() })
  .refine((s) => s.endDate === null || s.endDate >= s.startDate, {
    message: "la fin doit suivre le début",
  })
  .nullable();
const nameSchema = z.string().trim().min(1, "nom requis").max(60);

const fail = (errors: string[]): ActionResult => ({ ok: false, errors });
const zodErrors = (e: z.ZodError) => e.issues.map((i) => i.message);

/** Exécute une opération ; un refus métier devient un message, une ressource absente aussi. */
async function run(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    const result = await fn();
    revalidatePath("/contrats");
    return result === null || result === false ? fail(["contrat introuvable"]) : { ok: true };
  } catch (err) {
    if (err instanceof ContractError) return fail(err.messages);
    throw err;
  }
}

/** Nouveau contrat : nom, grille complète et souscription éventuelle. */
export async function createContractAction(input: {
  name: unknown;
  contract: unknown;
  subscription: unknown;
}): Promise<ActionResult> {
  const parsed = parseContractInput({ name: input.name, contract: input.contract });
  if (!parsed.success) return fail(parsed.errors.map((e) => e.message));
  const subscription = subscriptionSchema.safeParse(input.subscription);
  if (!subscription.success) return fail(zodErrors(subscription.error));
  const ctx = await getHouseholdContext();
  return run(() => createContract(ctx, { ...parsed.data, subscription: subscription.data }));
}

/** Nom et dates de souscription d'un contrat existant. */
export async function updateContractAction(
  id: string,
  input: { name: unknown; subscription: unknown },
): Promise<ActionResult> {
  const name = nameSchema.safeParse(input.name);
  const subscription = subscriptionSchema.safeParse(input.subscription);
  if (!name.success) return fail(zodErrors(name.error));
  if (!subscription.success) return fail(zodErrors(subscription.error));
  const ctx = await getHouseholdContext();
  return run(() => updateContract(ctx, id, { name: name.data, subscription: subscription.data }));
}

/** Ajoute (periodId null) ou modifie une grille de prix datée. */
export async function savePricePeriodAction(
  contractId: string,
  periodId: string | null,
  input: { validFrom: unknown; contract: unknown },
): Promise<ActionResult> {
  const validFrom = day.safeParse(input.validFrom);
  if (!validFrom.success) return fail(["date d'effet attendue"]);
  const parsed = parseContractInput({ name: "grille", contract: input.contract });
  if (!parsed.success) return fail(parsed.errors.map((e) => e.message));
  const ctx = await getHouseholdContext();
  const period = { validFrom: validFrom.data, contract: parsed.data.contract };
  return run(() =>
    periodId ? updatePricePeriod(ctx, periodId, period) : addPricePeriod(ctx, contractId, period),
  );
}

export async function deletePricePeriodAction(periodId: string): Promise<ActionResult> {
  const ctx = await getHouseholdContext();
  return run(() => deletePricePeriod(ctx, periodId));
}

/** « J'ai changé de contrat le… » */
export async function switchContractAction(targetId: string, date: unknown): Promise<ActionResult> {
  const d = day.safeParse(date);
  if (!d.success) return fail(["date attendue"]);
  const ctx = await getHouseholdContext();
  return run(() => switchContract(ctx, targetId, d.data));
}

export async function duplicateContractAction(id: string): Promise<ActionResult> {
  const ctx = await getHouseholdContext();
  return run(() => duplicateContract(ctx, id));
}

export async function deleteContractAction(id: string): Promise<ActionResult> {
  const ctx = await getHouseholdContext();
  return run(() => deleteContract(ctx, id));
}

export async function setTempoColorAction(date: unknown, color: unknown): Promise<{ ok: boolean }> {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false };
  if (color !== null && color !== "bleu" && color !== "blanc" && color !== "rouge")
    return { ok: false };
  const ctx = await getHouseholdContext();
  await setManualTempoColor(ctx.householdId, date, color);
  revalidatePath("/contrats");
  return { ok: true };
}

/** Correction d'un jour du calendrier Zen Flex (null : retire la correction). */
export async function setSobrietyAction(
  date: unknown,
  sobriety: unknown,
): Promise<{ ok: boolean }> {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false };
  if (sobriety !== null && typeof sobriety !== "boolean") return { ok: false };
  const ctx = await getHouseholdContext();
  await setManualSobriety(ctx.householdId, date, sobriety);
  revalidatePath("/contrats");
  return { ok: true };
}
