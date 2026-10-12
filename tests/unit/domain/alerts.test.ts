import { describe, expect, it } from "vitest";
import {
  activeAlerts,
  alertsToSend,
  DEFAULT_ALERT_SETTINGS,
  evaluateAlerts,
  parseAlertSettings,
  type AlertFacts,
} from "@/domain/alerts";

const H = 3_600_000;
const NOW = Date.parse("2026-10-20T12:00:00Z");
const none: AlertFacts = {
  now: NOW,
  fuels: [],
  ha: null,
  solar: null,
  budget: null,
  market: null,
};
const run = (f: Partial<AlertFacts>, s = DEFAULT_ALERT_SETTINGS) =>
  evaluateAlerts({ ...none, ...f }, s);

describe("stock de combustible", () => {
  it("sous le seuil (3 semaines) : jours restants et sacs ; niveau 2 sous une semaine", () => {
    const [a] = run({ fuels: [{ fuel: "pellet", stock: 180, dailyUse: 15, bagKg: 15 }] });
    expect(a).toMatchObject({
      key: "fuel_stock:pellet",
      level: 1,
      title: "Stock de granulés bas",
      text: "Environ 12 jours de stock (12 sacs) au rythme des 3 dernières semaines.",
      href: "/chauffage",
      nav: "heating",
    });
    expect(
      run({ fuels: [{ fuel: "wood", stock: 0.5, dailyUse: 0.1, bagKg: 15 }] })[0],
    ).toMatchObject({
      level: 2,
      text: "Environ 5 jours de stock (0,5 stère) au rythme des 3 dernières semaines.",
    });
  });

  it("stock épuisé ; pas d'alerte sans consommation récente ou au-dessus du seuil", () => {
    expect(run({ fuels: [{ fuel: "pellet", stock: 0, dailyUse: 10, bagKg: 15 }] })[0]?.text).toBe(
      "Plus de stock au rythme actuel : pensez à commander.",
    );
    expect(run({ fuels: [{ fuel: "pellet", stock: 100, dailyUse: null, bagKg: 15 }] })).toEqual([]);
    expect(run({ fuels: [{ fuel: "pellet", stock: 400, dailyUse: 15, bagKg: 15 }] })).toEqual([]);
  });
});

describe("Home Assistant silencieux", () => {
  it("au-delà du seuil horaire ; niveau 2 après 24 h", () => {
    const silent = (h: number) => run({ ha: { lastPushMs: NOW - h * H, granularity: "hourly" } });
    expect(silent(5)).toEqual([]);
    expect(silent(9)[0]).toMatchObject({
      key: "ha_silent",
      level: 1,
      text: "Dernier envoi reçu il y a 9 h : vérifiez l'automatisation dans Home Assistant.",
      href: "/reglages?onglet=home-assistant",
      nav: null,
    });
    expect(silent(30)[0]?.level).toBe(2);
  });

  it("envoi quotidien : 26 h au moins avant d'alerter", () => {
    const daily = (h: number) => run({ ha: { lastPushMs: NOW - h * H, granularity: "daily" } });
    expect(daily(20)).toEqual([]);
    expect(daily(30)[0]?.level).toBe(1);
    expect(daily(80)[0]?.level).toBe(2);
  });
});

describe("rendement solaire", () => {
  it("3 jours sous le rendement habituel : écart moyen ; niveau 2 au-delà de 30 %", () => {
    expect(run({ solar: { deviations: [-0.2, -0.25, -0.18] } })[0]).toMatchObject({
      key: "solar_yield",
      level: 1,
      text: "21 % sous le rendement habituel depuis 3 jours, pour le même ensoleillement : panneaux sales, ombre nouvelle ou onduleur en défaut ?",
      nav: "roi",
    });
    expect(run({ solar: { deviations: [-0.4, -0.35, -0.3] } })[0]?.level).toBe(2);
  });

  it("un jour normal ou inconnu suffit à ne pas alerter", () => {
    expect(run({ solar: { deviations: [-0.2, -0.1, -0.3] } })).toEqual([]);
    expect(run({ solar: { deviations: [-0.2, null, -0.3] } })).toEqual([]);
    expect(run({ solar: { deviations: [-0.2, -0.3] } })).toEqual([]);
  });
});

describe("budget du mois", () => {
  const budget = (cents: number, elapsedDays = 10) => ({
    month: "2026-10",
    elapsedDays,
    cents,
    previousCents: 5000,
  });

  it("au-delà du seuil après une semaine ; niveau 2 au double du seuil", () => {
    expect(run({ budget: budget(5900) })[0]).toMatchObject({
      key: "budget",
      level: 1,
      title: "Dépense d'octobre en hausse",
      text: "+18 % (9 €) par rapport aux mêmes jours d'octobre 2025.",
      href: "/?p=2026-10",
      nav: "overview",
    });
    expect(run({ budget: budget(7000) })[0]?.level).toBe(2);
  });

  it("pas d'alerte avant 7 jours, sous le seuil ou sans N-1", () => {
    expect(run({ budget: budget(9000, 5) })).toEqual([]);
    expect(run({ budget: budget(5500) })).toEqual([]);
    expect(run({ budget: { ...budget(9000), previousCents: null } })).toEqual([]);
  });
});

describe("réglages", () => {
  it("une alerte désactivée ou un seuil personnel", () => {
    const facts = { ha: { lastPushMs: NOW - 9 * H, granularity: "hourly" as const } };
    const off = parseAlertSettings({ haSilent: { enabled: false, email: false, hours: 6 } });
    expect(run(facts, off)).toEqual([]);
    const later = parseAlertSettings({ haSilent: { enabled: true, email: false, hours: 12 } });
    expect(run(facts, later)).toEqual([]);
  });

  it("valeurs absentes ou hors bornes : celles par défaut", () => {
    expect(parseAlertSettings(undefined)).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(parseAlertSettings({ fuelStock: { enabled: true, weeks: 99 } }).fuelStock).toEqual(
      DEFAULT_ALERT_SETTINGS.fuelStock,
    );
    expect(parseAlertSettings({ budget: { enabled: false, percent: 25 } }).budget).toEqual({
      enabled: false,
      email: false,
      percent: 25,
    });
    expect(
      parseAlertSettings({ budget: { enabled: true, email: true, percent: 25 } }).budget.email,
    ).toBe(true);
  });
});

describe("alertes masquées", () => {
  const alerts = run({
    ha: { lastPushMs: NOW - 9 * H, granularity: "hourly" },
    solar: { deviations: [-0.4, -0.35, -0.3] },
  });

  it("niveau 2 d'abord ; masquée 7 jours sauf si elle s'aggrave", () => {
    expect(activeAlerts(alerts, [], NOW).map((a) => a.key)).toEqual(["solar_yield", "ha_silent"]);
    const dismissed = [{ key: "ha_silent", level: 1, dismissedAt: NOW - 2 * 24 * H }];
    expect(activeAlerts(alerts, dismissed, NOW).map((a) => a.key)).toEqual(["solar_yield"]);
    const old = [{ key: "ha_silent", level: 1, dismissedAt: NOW - 8 * 24 * H }];
    expect(activeAlerts(alerts, old, NOW)).toHaveLength(2);
    const worse = run({ ha: { lastPushMs: NOW - 30 * H, granularity: "hourly" } });
    expect(activeAlerts(worse, dismissed, NOW)).toHaveLength(1);
  });
});

describe("alertes par email", () => {
  const alerts = run({
    ha: { lastPushMs: NOW - 9 * H, granularity: "hourly" },
    solar: { deviations: [-0.2, -0.2, -0.2] },
  });
  const settings = {
    ...DEFAULT_ALERT_SETTINGS,
    haSilent: { enabled: true, email: true, hours: 6 },
  };

  it("seulement les alertes cochées « par email », une fois par niveau", () => {
    expect(alertsToSend(alerts, DEFAULT_ALERT_SETTINGS, []).map((a) => a.key)).toEqual([]);
    expect(alertsToSend(alerts, settings, []).map((a) => a.key)).toEqual(["ha_silent"]);
    expect(alertsToSend(alerts, settings, [{ key: "ha_silent", level: 1 }])).toEqual([]);
    const worse = run({ ha: { lastPushMs: NOW - 30 * H, granularity: "hourly" } });
    expect(alertsToSend(worse, settings, [{ key: "ha_silent", level: 1 }])).toHaveLength(1);
  });

  it("en push : toutes les alertes, une fois par niveau", () => {
    expect(alertsToSend(alerts, DEFAULT_ALERT_SETTINGS, [], "push")).toHaveLength(2);
    expect(
      alertsToSend(alerts, DEFAULT_ALERT_SETTINGS, [{ key: "ha_silent", level: 1 }], "push"),
    ).toHaveLength(1);
  });
});

describe("offre du marché moins chère", () => {
  it("au-delà du seuil (50 €/an par défaut), une alerte par offre", () => {
    expect(run({ market: { name: "EDF - Tempo", savingCents: 4_999 } })).toEqual([]);
    const [alert] = run({ market: { name: "EDF - Tempo", savingCents: 6_000 } });
    expect(alert).toMatchObject({
      key: "market_offer:EDF - Tempo",
      kind: "market_offer",
      level: 1,
      href: "/contrats",
      nav: "contracts",
    });
    expect(alert?.text).toContain("60 €");
    expect(run({ market: { name: "EDF - Tempo", savingCents: 10_000 } })[0]?.level).toBe(2);
  });

  it("désactivable, seuil réglable", () => {
    const facts = { ...none, market: { name: "X - Y", savingCents: 6_000 } };
    const off = parseAlertSettings({ marketOffer: { enabled: false, email: false, euros: 50 } });
    expect(evaluateAlerts(facts, off)).toEqual([]);
    const high = parseAlertSettings({ marketOffer: { enabled: true, email: false, euros: 100 } });
    expect(evaluateAlerts(facts, high)).toEqual([]);
    expect(parseAlertSettings({ marketOffer: { enabled: true, email: false, euros: 5 } })).toEqual(
      DEFAULT_ALERT_SETTINGS,
    );
  });
});
