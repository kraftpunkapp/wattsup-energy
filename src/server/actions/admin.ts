"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseContactTexts } from "@/domain/instance-texts";
import { parseSignupSettings, type SignupMode } from "@/domain/signup";
import { AdminError, deleteUserAsAdmin, ForbiddenError, setUserDisabled } from "../admin";
import { getHouseholdContext } from "../context";
import { updateContactTexts, updateSignupPolicy } from "../instance";
import { GitHubOfferSource } from "../market/source";
import { marketSyncEnabled, syncMarket, type MarketSyncResult } from "../market/sync";

export type AdminActionResult = { ok: true } | { ok: false; errors: string[] };

const userId = z.string().min(1).max(100);

async function run(fn: () => Promise<boolean>): Promise<AdminActionResult> {
  try {
    const found = await fn();
    revalidatePath("/admin/utilisateurs");
    return found ? { ok: true } : { ok: false, errors: ["compte introuvable"] };
  } catch (err) {
    if (err instanceof AdminError || err instanceof ForbiddenError) {
      return { ok: false, errors: [err.message] };
    }
    throw err;
  }
}

/** Désactive ou réactive un compte (administrateur seulement). */
export async function setUserDisabledAction(
  id: string,
  disabled: boolean,
): Promise<AdminActionResult> {
  const p = userId.safeParse(id);
  if (!p.success) return { ok: false, errors: ["compte introuvable"] };
  const ctx = await getHouseholdContext();
  return run(() => setUserDisabled(ctx, p.data, disabled === true));
}

/** Supprime un compte et toutes ses données (administrateur seulement). */
export async function deleteUserAction(id: string): Promise<AdminActionResult> {
  const p = userId.safeParse(id);
  if (!p.success) return { ok: false, errors: ["compte introuvable"] };
  const ctx = await getHouseholdContext();
  return run(() => deleteUserAsAdmin(ctx, p.data));
}

const signupMode = z.enum(["open", "invite", "closed"]);

/** Mode d'inscription de l'instance et codes d'invitation (administrateur seulement). */
export async function saveSignupPolicyAction(
  mode: SignupMode,
  rawCodes: string,
): Promise<AdminActionResult> {
  const m = signupMode.safeParse(mode);
  if (!m.success || typeof rawCodes !== "string" || rawCodes.length > 2000) {
    return { ok: false, errors: ["réglage invalide"] };
  }
  const parsed = parseSignupSettings(m.data, rawCodes);
  if (!parsed.ok) return { ok: false, errors: [parsed.message] };
  const ctx = await getHouseholdContext();
  return run(async () => {
    await updateSignupPolicy(ctx, { mode: m.data, codes: parsed.codes });
    return true;
  });
}

/** Intitulé de l'entrée Contact et textes de la page Contact (administrateur seulement). */
export async function saveContactTextsAction(raw: {
  label: unknown;
  intro: unknown;
  notice: unknown;
}): Promise<AdminActionResult> {
  const parsed = parseContactTexts(raw);
  if (!parsed.ok) return { ok: false, errors: [parsed.message] };
  const ctx = await getHouseholdContext();
  try {
    await updateContactTexts(ctx, parsed.value);
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, errors: [err.message] };
    throw err;
  }
  // L'intitulé apparaît dans le menu de toutes les pages.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Importe le catalogue des offres du marché tout de suite (administrateur seulement). */
export async function refreshMarketAction(): Promise<
  { ok: true; result: MarketSyncResult } | { ok: false; errors: string[] }
> {
  const ctx = await getHouseholdContext();
  if (!ctx.isAdmin) return { ok: false, errors: [new ForbiddenError().message] };
  if (!marketSyncEnabled()) {
    return {
      ok: false,
      errors: ["synchronisation désactivée sur cette instance (MARKET_SYNC=off)"],
    };
  }
  const result = await syncMarket(new GitHubOfferSource(), { force: true });
  revalidatePath("/admin/offres");
  return { ok: true, result };
}
