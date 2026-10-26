import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { household, user } from "@/db/schema";
import type { MailContent } from "@/domain/mail";
import { tomorrowEmail } from "@/domain/mail";
import { parseTomorrowNotice, tomorrowNotice } from "@/domain/forecast/notify";
import { addDays, localParts } from "@/lib/time";
import { householdContextFor, type HouseholdContext } from "./context";
import { getForecastPlan } from "./forecast";
import { mailConfigured, sendMail } from "./mail";
import { pushToHousehold, type PushSender } from "./push";

// Notification du soir « Créneaux de demain » (T74, SPEC §7.14) : facultative, par push et,
// si demandé, par email ; une seule par soir (jour retenu dans les réglages du foyer).

/** Heures locales où la notification peut partir : jamais au rattrapage d'un redémarrage. */
const EVENING = { from: 19, to: 23 };

export async function notifyTomorrow(
  ctx: HouseholdContext,
  options: {
    now?: Date;
    origin?: string;
    send?: PushSender;
    mail?: (to: string, content: MailContent) => Promise<void>;
  } = {},
): Promise<{ push: number; email: boolean }> {
  const none = { push: 0, email: false };
  const settings = parseTomorrowNotice(ctx.settings.tomorrowNotice);
  if (!settings.enabled) return none;
  const now = options.now ?? new Date();
  const tomorrow = addDays(localParts(now, ctx.timezone).date, 1);
  if (ctx.settings.tomorrowNoticeSentFor === tomorrow) return none;
  const plan = await getForecastPlan(ctx, now);
  if (plan.status !== "ok") return none;
  const notice = tomorrowNotice(plan.windows, tomorrow, ctx.timezone);
  if (!notice) return none;

  const push = await pushToHousehold(
    ctx,
    { ...notice, url: "/previsions", tag: "wattsup-tomorrow" },
    options.send,
  );
  let email = false;
  if (settings.email && ctx.userEmail && options.origin && (options.mail || mailConfigured())) {
    await (options.mail ?? ((to, c) => sendMail(to, c)))(
      ctx.userEmail,
      tomorrowEmail(notice, options.origin),
    );
    email = true;
  }
  if (push > 0 || email) {
    await db
      .update(household)
      .set({
        settings: sql`${household.settings} || ${JSON.stringify({ tomorrowNoticeSentFor: tomorrow })}::jsonb`,
      })
      .where(eq(household.id, ctx.householdId));
  }
  return { push, email };
}

/** Tâche du planificateur (20 h) : chaque foyer actif qui l'a demandée, le soir seulement. */
export async function notifyTomorrowForAll(
  origin: string | undefined,
  now = new Date(),
): Promise<{ households: number; sent: number }> {
  const rows = await db
    .select({
      ownerId: household.ownerId,
      name: user.name,
      email: user.email,
      disabledAt: user.disabledAt,
    })
    .from(household)
    .innerJoin(user, eq(user.id, household.ownerId))
    .where(sql`${household.settings} -> 'tomorrowNotice' ->> 'enabled' = 'true'`);
  let sent = 0;
  let households = 0;
  for (const r of rows) {
    if (r.disabledAt) continue;
    try {
      const ctx = await householdContextFor(r.ownerId, r.name, r.email);
      const hour = localParts(now, ctx.timezone).hour;
      if (hour < EVENING.from || hour >= EVENING.to) continue;
      households += 1;
      const res = await notifyTomorrow(ctx, { now, origin });
      if (res.push > 0 || res.email) sent += 1;
    } catch (err) {
      console.error("[créneaux de demain] envoi impossible pour un foyer :", err);
    }
  }
  return { households, sent };
}
