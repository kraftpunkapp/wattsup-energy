import { formatAgo, formatEurFromCents, formatNumber, formatPercent } from "@/lib/format";
import { settingsHref } from "@/lib/settings-tabs";
import type { Fuel } from "./heating/fuel";
import { monthLabel } from "./overview";
import type { NavId } from "./profile";

// Alertes (SPEC §9, Vue d'ensemble « À surveiller ») : stock de combustible bas, Home
// Assistant silencieux, production solaire en baisse, dépense du mois en hausse, offre du
// marché nettement moins chère que le contrat actuel (SPEC §7.12). Calculées à
// partir de faits réunis par le serveur (seulement pour les modules du profil). Chaque alerte a
// un niveau (1, 2 = plus grave) : une alerte masquée revient si elle s'aggrave. Pur.

export const ALERT_KINDS = [
  "fuel_stock",
  "ha_silent",
  "solar_yield",
  "budget",
  "market_offer",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Chaque alerte : affichée ou non, seuil, et envoi par email (décoché par défaut). */
export interface AlertSettings {
  fuelStock: { enabled: boolean; email: boolean; weeks: number };
  haSilent: { enabled: boolean; email: boolean; hours: number };
  solarYield: { enabled: boolean; email: boolean; percent: number };
  budget: { enabled: boolean; email: boolean; percent: number };
  marketOffer: { enabled: boolean; email: boolean; euros: number };
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  fuelStock: { enabled: true, email: false, weeks: 3 },
  haSilent: { enabled: true, email: false, hours: 6 },
  solarYield: { enabled: true, email: false, percent: 15 },
  budget: { enabled: true, email: false, percent: 15 },
  marketOffer: { enabled: true, email: false, euros: 50 },
};

/** Réglage de chaque type d'alerte. */
export const SETTINGS_OF: Record<AlertKind, keyof AlertSettings> = {
  fuel_stock: "fuelStock",
  ha_silent: "haSilent",
  solar_yield: "solarYield",
  budget: "budget",
  market_offer: "marketOffer",
};

/** Bornes des seuils réglables (Réglages › Alertes). */
export const ALERT_LIMITS = {
  fuelStock: { key: "weeks", min: 1, max: 12 },
  haSilent: { key: "hours", min: 2, max: 72 },
  solarYield: { key: "percent", min: 5, max: 50 },
  budget: { key: "percent", min: 5, max: 100 },
  marketOffer: { key: "euros", min: 10, max: 500 },
} as const;

/**
 * Réglages enregistrés (JSONB) : chaque entrée invalide reprend sa valeur par défaut ; un
 * réglage antérieur à l'envoi par email (sans `email`) n'envoie rien.
 */
export function parseAlertSettings(raw: unknown): AlertSettings {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const out = structuredClone(DEFAULT_ALERT_SETTINGS) as unknown as Record<
    string,
    { enabled: boolean } & Record<string, number | boolean>
  >;
  for (const [name, limit] of Object.entries(ALERT_LIMITS)) {
    const entry = src[name] as Record<string, unknown> | undefined;
    const value = entry?.[limit.key];
    if (
      typeof entry?.enabled === "boolean" &&
      (entry.email === undefined || typeof entry.email === "boolean") &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= limit.min &&
      value <= limit.max
    ) {
      out[name] = { enabled: entry.enabled, email: entry.email === true, [limit.key]: value };
    }
  }
  return out as unknown as AlertSettings;
}

/** Ce que le serveur sait du foyer ; null : module absent du profil ou donnée indisponible. */
export interface AlertFacts {
  now: number;
  /** Stock en unité de base (kg, stères) et consommation moyenne des 3 dernières semaines. */
  fuels: { fuel: Fuel; stock: number; dailyUse: number | null; bagKg: number }[];
  /** Dernier envoi accepté ; null si Home Assistant n'a jamais rien envoyé. */
  ha: { lastPushMs: number; granularity: "hourly" | "daily" } | null;
  /** Écart au rendement habituel des 3 derniers jours complets (null : jour inexploitable). */
  solar: { deviations: (number | null)[] } | null;
  /** Dépense du mois en cours et des mêmes jours un an plus tôt. */
  budget: {
    month: string;
    elapsedDays: number;
    cents: number;
    previousCents: number | null;
  } | null;
  /** Offre du marché la moins chère et son économie annuelle sur le contrat actuel. */
  market: { name: string; savingCents: number } | null;
}

export interface Alert {
  /** Identifiant stable (masquage) : type, et combustible pour le stock. */
  key: string;
  kind: AlertKind;
  level: 1 | 2;
  title: string;
  text: string;
  href: string;
  action: string;
  /** Entrée de menu qui porte une pastille ; null : aucune (HA a déjà son statut). */
  nav: NavId | null;
}

const DAY_MS = 86_400_000;
const FUEL_NAME: Record<Fuel, string> = { pellet: "granulés", wood: "bois" };

function fuelAlert(f: AlertFacts["fuels"][number], s: AlertSettings): Alert | null {
  if (!s.fuelStock.enabled || f.dailyUse === null || f.dailyUse <= 0) return null;
  const days = f.stock / f.dailyUse;
  if (days >= s.fuelStock.weeks * 7) return null;
  const qty =
    f.fuel === "pellet"
      ? `${formatNumber(Math.round(f.stock / f.bagKg))} sacs`
      : `${formatNumber(f.stock, 1)} stère${f.stock >= 2 ? "s" : ""}`;
  return {
    key: `fuel_stock:${f.fuel}`,
    kind: "fuel_stock",
    level: days <= 7 ? 2 : 1,
    title: `Stock de ${FUEL_NAME[f.fuel]} bas`,
    text:
      days < 1
        ? "Plus de stock au rythme actuel : pensez à commander."
        : `Environ ${Math.floor(days)} jours de stock (${qty}) au rythme des 3 dernières semaines.`,
    href: "/chauffage",
    action: "Prévoir la commande",
    nav: "heating",
  };
}

function haAlert(ha: NonNullable<AlertFacts["ha"]>, now: number, s: AlertSettings): Alert | null {
  if (!s.haSilent.enabled) return null;
  // Un envoi quotidien n'est en retard qu'après un jour et deux heures.
  const daily = ha.granularity === "daily";
  const threshold = (daily ? Math.max(s.haSilent.hours, 26) : s.haSilent.hours) * 3_600_000;
  const silence = now - ha.lastPushMs;
  if (silence < threshold) return null;
  return {
    key: "ha_silent",
    kind: "ha_silent",
    level: silence >= (daily ? 72 : 24) * 3_600_000 ? 2 : 1,
    title: "Home Assistant silencieux",
    text: `Dernier envoi reçu ${formatAgo(silence)} : vérifiez l'automatisation dans Home Assistant.`,
    href: settingsHref("home-assistant"),
    action: "Voir les derniers envois",
    nav: null,
  };
}

function solarAlert(deviations: (number | null)[], s: AlertSettings): Alert | null {
  if (!s.solarYield.enabled || deviations.length < 3) return null;
  const limit = -s.solarYield.percent / 100;
  if (deviations.some((d) => d === null || d > limit)) return null;
  const average = deviations.reduce<number>((a, d) => a + (d ?? 0), 0) / deviations.length;
  return {
    key: "solar_yield",
    kind: "solar_yield",
    level: average <= -0.3 ? 2 : 1,
    title: "Production solaire en baisse",
    text: `${formatPercent(-average)} sous le rendement habituel depuis 3 jours, pour le même ensoleillement : panneaux sales, ombre nouvelle ou onduleur en défaut ?`,
    href: "/rentabilite",
    action: "Voir la rentabilité",
    nav: "roi",
  };
}

function budgetAlert(b: NonNullable<AlertFacts["budget"]>, s: AlertSettings): Alert | null {
  if (!s.budget.enabled || b.elapsedDays < 7 || !b.previousCents || b.previousCents <= 0) {
    return null;
  }
  const rise = b.cents / b.previousCents - 1;
  const limit = s.budget.percent / 100;
  if (rise < limit) return null;
  const month = monthLabel(b.month).split(" ")[0] ?? "";
  const previous = `${month} ${Number(b.month.slice(0, 4)) - 1}`;
  const of = (m: string) => (/^[aeiouéo]/i.test(m) ? `d'${m}` : `de ${m}`);
  return {
    key: "budget",
    kind: "budget",
    level: rise >= 2 * limit ? 2 : 1,
    title: `Dépense ${of(month)} en hausse`,
    text: `+${formatPercent(rise)} (${formatEurFromCents(b.cents - b.previousCents, 0)}) par rapport aux mêmes jours ${of(previous)}.`,
    href: `/?p=${b.month}`,
    action: "Voir le détail",
    nav: "overview",
  };
}

function marketAlert(m: NonNullable<AlertFacts["market"]>, s: AlertSettings): Alert | null {
  const threshold = s.marketOffer.euros * 100;
  if (!s.marketOffer.enabled || m.savingCents < threshold) return null;
  return {
    // Une alerte par offre : une autre offre plus avantageuse est signalée à son tour.
    key: `market_offer:${m.name}`,
    kind: "market_offer",
    level: m.savingCents >= 2 * threshold ? 2 : 1,
    title: "Une offre moins chère que votre contrat",
    text: `${m.name} : environ ${formatEurFromCents(m.savingCents, 0)} d'économie par an sur votre consommation des 12 derniers mois. À vérifier sur le site du fournisseur.`,
    href: "/contrats",
    action: "Comparer les offres",
    nav: "contracts",
  };
}

/** Alertes en cours, les plus graves d'abord (puis dans l'ordre des types). */
export function evaluateAlerts(facts: AlertFacts, settings: AlertSettings): Alert[] {
  const alerts = [
    ...facts.fuels.map((f) => fuelAlert(f, settings)),
    facts.ha ? haAlert(facts.ha, facts.now, settings) : null,
    facts.solar ? solarAlert(facts.solar.deviations, settings) : null,
    facts.budget ? budgetAlert(facts.budget, settings) : null,
    facts.market ? marketAlert(facts.market, settings) : null,
  ].filter((a): a is Alert => a !== null);
  return alerts.sort(
    (a, b) => b.level - a.level || ALERT_KINDS.indexOf(a.kind) - ALERT_KINDS.indexOf(b.kind),
  );
}

/** Une alerte masquée le reste 7 jours, sauf si elle s'aggrave (niveau supérieur). */
export const DISMISS_DAYS = 7;

export function activeAlerts(
  alerts: readonly Alert[],
  dismissals: readonly { key: string; level: number; dismissedAt: number }[],
  now: number,
): Alert[] {
  return alerts.filter((a) => {
    const d = dismissals.find((x) => x.key === a.key);
    return !d || a.level > d.level || now - d.dismissedAt >= DISMISS_DAYS * DAY_MS;
  });
}

/**
 * Alertes à envoyer hors de l'appli, jamais envoyées ou passées à un niveau supérieur depuis
 * le dernier envoi (une alerte qui dure n'est pas répétée). Par email : seulement celles dont
 * la case est cochée ; en push : toutes (abonner un appareil vaut accord).
 */
export function alertsToSend(
  alerts: readonly Alert[],
  settings: AlertSettings,
  sent: readonly { key: string; level: number }[],
  channel: "email" | "push" = "email",
): Alert[] {
  return alerts.filter((a) => {
    if (channel === "email" && !settings[SETTINGS_OF[a.kind]].email) return false;
    const previous = sent.find((s) => s.key === a.key);
    return !previous || a.level > previous.level;
  });
}
