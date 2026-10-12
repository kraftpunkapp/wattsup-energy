import { and, eq, gte, inArray, lt, notInArray, sql, sum } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import {
  alertDismissal,
  alertNotification,
  energyInterval,
  household,
  user,
  weatherDaily,
} from "@/db/schema";
import {
  activeAlerts,
  alertsToSend,
  evaluateAlerts,
  parseAlertSettings,
  type Alert,
  type AlertFacts,
  type AlertSettings,
} from "@/domain/alerts";
import { currentStock, seasonConsumption, type Fuel } from "@/domain/heating/fuel";
import { visibleModules } from "@/domain/profile";
import { recentYieldDeviations } from "@/domain/roi/yield";
import { buildTimeline, priceTimeline } from "@/domain/tariff/timeline";
import { cellOf, radiationKwhM2 } from "@/domain/weather";
import { addDays, eachDay, localParts, zonedInstant } from "@/lib/time";
import { alertsEmail, type MailContent } from "@/domain/mail";
import { householdContextFor, type HouseholdContext } from "./context";
import { listContracts } from "./contracts";
import { listFuelEvents } from "./fuel";
import { getLastPushAt } from "./ingest/status";
import { knownMarketSaving } from "./market/compare";
import { mailConfigured, sendMail } from "./mail";
import { gridIntervals } from "./queries/overview";
import { tempoColorsFor } from "./tempo/sync";

// Alertes du foyer (T44) : réunit les faits (seulement pour les modules du profil), les
// évalue (src/domain/alerts.ts) et retire celles que l'utilisateur a masquées. Chaque
// opération filtre par ctx.householdId.

/** Consommation récente des combustibles : moyenne des 21 derniers jours. */
const RECENT_DAYS = 21;

async function fuelFacts(ctx: HouseholdContext, now: Date): Promise<AlertFacts["fuels"]> {
  const vis = visibleModules(ctx.profile);
  const fuels: Fuel[] = [
    ...(vis.pellet ? ["pellet" as const] : []),
    ...(vis.wood ? ["wood" as const] : []),
  ];
  if (fuels.length === 0) return [];
  const events = await listFuelEvents(ctx);
  const window = { from: new Date(now.getTime() - RECENT_DAYS * 86_400_000), to: now };
  return fuels.map((fuel) => {
    const used = seasonConsumption(events, fuel, window, ctx.settings).qty;
    return {
      fuel,
      stock: Math.max(0, currentStock(events, fuel, now, ctx.settings)),
      dailyUse: used > 0 ? used / RECENT_DAYS : null,
      bagKg: ctx.settings.pelletBagKg,
    };
  });
}

/** Production solaire par jour local et irradiation de la commune, sur 13 mois. */
async function solarFacts(ctx: HouseholdContext, today: string): Promise<AlertFacts["solar"]> {
  if (!ctx.profile.solar) return null;
  const [home] = await db
    .select({ location: household.location })
    .from(household)
    .where(eq(household.id, ctx.householdId));
  if (!home?.location) return null;
  const cell = cellOf(home.location);
  const from = `${addDays(today, -400).slice(0, 7)}-01`;
  const local = sql`(${energyInterval.start} at time zone ${ctx.timezone})`;
  const [production, weather] = await Promise.all([
    db
      .select({
        date: sql<string>`to_char(${local}, 'YYYY-MM-DD')`,
        kwh: sum(energyInterval.kwh).mapWith(Number),
      })
      .from(energyInterval)
      .where(
        and(
          eq(energyInterval.householdId, ctx.householdId),
          eq(energyInterval.metric, "solar_production"),
          gte(energyInterval.start, zonedInstant(from, 0, ctx.timezone)),
          lt(energyInterval.start, zonedInstant(today, 0, ctx.timezone)),
        ),
      )
      .groupBy(sql`1`),
    db
      .select({ date: weatherDaily.date, radiation: weatherDaily.radiationMjM2 })
      .from(weatherDaily)
      .where(
        and(
          eq(weatherDaily.latE2, cell.latE2),
          eq(weatherDaily.lonE2, cell.lonE2),
          gte(weatherDaily.date, from),
          lt(weatherDaily.date, today),
        ),
      ),
  ]);
  const kwh = new Map(production.map((p) => [p.date, p.kwh]));
  const days = weather
    .filter((w) => kwh.has(w.date))
    .map((w) => ({
      date: w.date,
      kwh: kwh.get(w.date) ?? 0,
      radiationKwhM2: radiationKwhM2(w.radiation),
    }));
  const deviations = recentYieldDeviations(
    days,
    today,
    [1, 2, 3].map((n) => addDays(today, -n)),
  );
  return deviations && { deviations };
}

/** Dépense d'électricité du mois en cours et des mêmes jours un an plus tôt. */
async function budgetFacts(ctx: HouseholdContext, today: string): Promise<AlertFacts["budget"]> {
  const month = today.slice(0, 7);
  const from = `${month}-01`;
  const to = addDays(today, 1);
  const shift = (d: string) =>
    `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`.replace(/-02-29$/, "-02-28");
  const [contracts, current, previous] = await Promise.all([
    listContracts(ctx),
    gridIntervals(ctx, from, to),
    gridIntervals(ctx, shift(from), shift(to)),
  ]);
  if (current.length === 0) return null;
  const colors = await tempoColorsFor(ctx.householdId, addDays(shift(from), -1), to);
  const pricing = { timezone: ctx.timezone, tempoColor: (d: string) => colors.get(d) };
  const cost = (list: typeof current, a: string, b: string) => {
    const timeline = buildTimeline(contracts, a, b, today);
    return timeline.some((s) => s.contract)
      ? priceTimeline(list, timeline, pricing).totalCents
      : null;
  };
  const cents = cost(current, from, to);
  if (cents === null) return null;
  return {
    month,
    elapsedDays: eachDay(from, to).length,
    cents,
    previousCents: previous.length > 0 ? cost(previous, shift(from), shift(to)) : null,
  };
}

/** Faits du foyer pour les alertes (modules du profil seulement). */
export async function alertFacts(ctx: HouseholdContext, now = new Date()): Promise<AlertFacts> {
  const today = localParts(now, ctx.timezone).date;
  const [fuels, lastPush, solar, budget] = await Promise.all([
    fuelFacts(ctx, now),
    getLastPushAt(ctx),
    solarFacts(ctx, today),
    budgetFacts(ctx, today),
  ]);
  return {
    now: now.getTime(),
    fuels,
    ha: lastPush ? { lastPushMs: lastPush.getTime(), granularity: ctx.granularity } : null,
    solar,
    budget,
    market: knownMarketSaving(ctx.householdId),
  };
}

export const alertSettings = (ctx: HouseholdContext): AlertSettings =>
  parseAlertSettings(ctx.settings.alerts);

/**
 * Alertes à afficher (non masquées), les plus graves d'abord. Les masquages d'alertes qui
 * n'ont plus lieu d'être sont effacés : si le problème revient, l'alerte réapparaît.
 * Mis en cache pour la requête (mise en page et Vue d'ensemble la partagent).
 */
export const getAlerts = cache(
  async (ctx: HouseholdContext, now = new Date()): Promise<Alert[]> => {
    const alerts = evaluateAlerts(await alertFacts(ctx, now), alertSettings(ctx));
    const keys = alerts.map((a) => a.key);
    await db
      .delete(alertDismissal)
      .where(
        and(
          eq(alertDismissal.householdId, ctx.householdId),
          keys.length > 0 ? notInArray(alertDismissal.key, keys) : undefined,
        ),
      );
    if (keys.length === 0) return [];
    const dismissals = await db
      .select()
      .from(alertDismissal)
      .where(
        and(eq(alertDismissal.householdId, ctx.householdId), inArray(alertDismissal.key, keys)),
      );
    return activeAlerts(
      alerts,
      dismissals.map((d) => ({ key: d.key, level: d.level, dismissedAt: d.dismissedAt.getTime() })),
      now.getTime(),
    );
  },
);

/** Masque une alerte à son niveau actuel (elle revient si elle s'aggrave). */
export async function dismissAlert(
  ctx: HouseholdContext,
  key: string,
  level: number,
  now = new Date(),
): Promise<void> {
  await db
    .insert(alertDismissal)
    .values({ householdId: ctx.householdId, key, level, dismissedAt: now })
    .onConflictDoUpdate({
      target: [alertDismissal.householdId, alertDismissal.key],
      set: { level, dismissedAt: now },
    });
}

/** Activation et seuils des alertes (Réglages › Alertes), fusionnés dans household.settings. */
export async function updateAlertSettings(ctx: HouseholdContext, input: AlertSettings) {
  const [row] = await db
    .update(household)
    .set({
      settings: sql`${household.settings} || ${JSON.stringify({ alerts: input })}::jsonb`,
    })
    .where(eq(household.id, ctx.householdId))
    .returning({ settings: household.settings });
  return row ? parseAlertSettings(row.settings.alerts) : null;
}

/**
 * Alertes nouvelles ou aggravées d'un foyer pour un canal (email, push), remises à `deliver`
 * puis notées comme envoyées. Une alerte réglée efface sa trace : si elle revient, elle
 * repart. Renvoie le nombre d'alertes remises (0 si `deliver` n'a rien pu remettre).
 */
export async function sendNewAlerts(
  ctx: HouseholdContext,
  channel: "email" | "push",
  deliver: (alerts: Alert[]) => Promise<boolean>,
  now = new Date(),
): Promise<number> {
  const settings = alertSettings(ctx);
  const alerts = evaluateAlerts(await alertFacts(ctx, now), settings);
  const mine = and(
    eq(alertNotification.householdId, ctx.householdId),
    eq(alertNotification.channel, channel),
  );
  const keys = alerts.map((a) => a.key);
  await db
    .delete(alertNotification)
    .where(and(mine, keys.length > 0 ? notInArray(alertNotification.key, keys) : undefined));
  const sent = await db.select().from(alertNotification).where(mine);
  const toSend = alertsToSend(alerts, settings, sent, channel);
  if (toSend.length === 0 || !(await deliver(toSend))) return 0;
  for (const a of toSend) {
    await db
      .insert(alertNotification)
      .values({ householdId: ctx.householdId, key: a.key, channel, level: a.level, sentAt: now })
      .onConflictDoUpdate({
        target: [alertNotification.householdId, alertNotification.key, alertNotification.channel],
        set: { level: a.level, sentAt: now },
      });
  }
  return toSend.length;
}

/** Alertes par email (cases « Recevoir aussi par email »), à l'adresse du compte. */
export async function emailAlerts(
  ctx: HouseholdContext,
  options: {
    origin: string;
    now?: Date;
    send?: (to: string, content: MailContent) => Promise<void>;
  },
): Promise<number> {
  if (!ctx.userEmail) return 0;
  const send = options.send ?? ((to, c) => sendMail(to, c));
  return sendNewAlerts(
    ctx,
    "email",
    async (alerts) => {
      await send(ctx.userEmail, alertsEmail(alerts, options.origin));
      return true;
    },
    options.now,
  );
}

/**
 * Tâche du planificateur (toutes les heures) : chaque foyer qui a coché au moins une alerte
 * « par email », compte actif. Un foyer en échec n'arrête pas les autres.
 */
export async function emailAlertsForAll(
  origin: string,
): Promise<{ households: number; sent: number }> {
  if (!mailConfigured()) return { households: 0, sent: 0 };
  const rows = await db
    .select({
      ownerId: household.ownerId,
      settings: household.settings,
      name: user.name,
      email: user.email,
      disabledAt: user.disabledAt,
    })
    .from(household)
    .innerJoin(user, eq(user.id, household.ownerId));
  const wanted = rows.filter(
    (r) =>
      !r.disabledAt && Object.values(parseAlertSettings(r.settings.alerts)).some((s) => s.email),
  );
  let sent = 0;
  for (const r of wanted) {
    try {
      sent += await emailAlerts(await householdContextFor(r.ownerId, r.name, r.email), { origin });
    } catch (err) {
      console.error("[alertes] envoi impossible pour un foyer :", err);
    }
  }
  return { households: wanted.length, sent };
}
