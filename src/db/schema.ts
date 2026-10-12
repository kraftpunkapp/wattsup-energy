import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { EnergyProfile } from "../domain/profile";
import type { SourceTariff } from "../domain/market/offer";
import type { Contract } from "../domain/tariff/types";
import { user } from "./auth-schema";

export * from "./auth-schema";

// Modèle de données : SPEC §5. Toute table métier porte household_id.

export const granularity = pgEnum("granularity", ["hourly", "daily"]);

export type { EnergyProfile } from "../domain/profile";

export interface HouseholdSettings {
  exportEnabled: boolean;
  exportPriceEurKwh: number;
  batteryGridCharging: boolean;
  pelletBagKg: number;
  pelletBagsPerPallet: number;
  /** Bornes de la saison de chauffe, "MM-JJ". */
  heatingSeason: { from: string; to: string };
  kwhFactors: { pelletPerKg: number; woodPerStere: number };
  /** Alertes (T44) : activation et seuils ; absent, les valeurs par défaut s'appliquent. */
  alerts?: unknown;
  /** Vue d'ensemble (T50) : `{ hidden: [...] }`, blocs masqués ; absent, tout est affiché. */
  overview?: unknown;
  /** Puissance souscrite du compteur en kVA (T55, offres du marché) ; absente tant que non saisie. */
  meterPowerKva?: number;
}

/** Commune du foyer pour la météo ; coordonnées arrondies à 0,01° (SPEC §7.9). */
export interface HouseholdLocation {
  label: string;
  lat: number;
  lon: number;
}

export const DEFAULT_PROFILE: EnergyProfile = {
  solar: false,
  battery: false,
  pellet: false,
  wood: false,
  electricHeating: false,
};

export const DEFAULT_SETTINGS: HouseholdSettings = {
  exportEnabled: false,
  exportPriceEurKwh: 0,
  batteryGridCharging: false,
  pelletBagKg: 15,
  pelletBagsPerPallet: 66,
  heatingSeason: { from: "10-01", to: "04-30" },
  kwhFactors: { pelletPerKg: 4.8, woodPerStere: 1800 },
};

export const household = pgTable("household", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Mon foyer"),
  timezone: text("timezone").notNull().default("Europe/Paris"),
  granularity: granularity("granularity").notNull().default("hourly"),
  profile: jsonb("profile").$type<EnergyProfile>().notNull().default(DEFAULT_PROFILE),
  settings: jsonb("settings").$type<HouseholdSettings>().notNull().default(DEFAULT_SETTINGS),
  location: jsonb("location").$type<HouseholdLocation>(),
  /** Parcours de bienvenue (T31) : étape atteinte (0–4) ; terminé ou passé. */
  onboardingStep: integer("onboarding_step").notNull().default(0),
  onboardingDone: boolean("onboarding_done").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

const householdRef = () =>
  uuid("household_id")
    .notNull()
    .references(() => household.id, { onDelete: "cascade" });

/** Tokens d'ingestion HA : seul le hash sha-256 est stocké (SPEC §5, §12). */
export const ingestToken = pgTable(
  "ingest_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    /** Début du token, affiché pour l'identifier (ex. "wu_3fA9k2Lm"). */
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("ingest_token_household_idx").on(t.householdId),
    // Un seul token actif par foyer.
    uniqueIndex("ingest_token_one_active_idx")
      .on(t.householdId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

/** Postes de consommation sur mesure ; le slug est la clé du bloc `categories` du payload. */
export const category = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    icon: text("icon"),
    color: text("color"),
    isHeating: boolean("is_heating").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("category_household_slug_uq").on(t.householdId, t.slug)],
);

/** Dernier index cumulé reçu par métrique (mode horaire), pour calculer les deltas. */
export const meterState = pgTable(
  "meter_state",
  {
    householdId: householdRef(),
    metric: text("metric").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    value: doublePrecision("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.metric] })],
);

export const intervalGranularity = pgEnum("interval_granularity", ["hour", "day"]);
/** Origine d'une valeur : envoi HA, import CSV, ou correction manuelle (onglet Données). */
export const dataSource = pgEnum("data_source", ["ha", "csv", "manual"]);

/**
 * Table de faits : énergie par intervalle. `tariff_slot` vaut "all" sauf pour les
 * totaux journaliers ventilés HP/HC.
 */
export const energyInterval = pgTable(
  "energy_interval",
  {
    householdId: householdRef(),
    metric: text("metric").notNull(),
    start: timestamp("start", { withTimezone: true }).notNull(),
    granularity: intervalGranularity("granularity").notNull(),
    tariffSlot: text("tariff_slot", { enum: ["all", "hp", "hc"] })
      .notNull()
      .default("all"),
    kwh: numeric("kwh", { precision: 12, scale: 4, mode: "number" }).notNull(),
    source: dataSource("source").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.metric, t.start, t.granularity, t.tariffSlot] }),
    index("energy_interval_household_start_idx").on(t.householdId, t.start),
  ],
);

/**
 * Météo quotidienne Open-Meteo, globale par maille de 0,01° (coordonnées × 100) :
 * donnée publique partagée par les foyers d'une même maille. DJU calculé à la lecture.
 */
export const weatherDaily = pgTable(
  "weather_daily",
  {
    latE2: integer("lat_e2").notNull(),
    lonE2: integer("lon_e2").notNull(),
    date: date("date").notNull(),
    tMin: real("t_min"),
    tMax: real("t_max"),
    tMean: real("t_mean"),
    sunshineS: real("sunshine_s"),
    radiationMjM2: real("radiation_mj_m2"),
    source: text("source", { enum: ["forecast", "archive"] }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.latE2, t.lonE2, t.date] })],
);

export const tempoColor = pgEnum("tempo_color", ["bleu", "blanc", "rouge"]);

/** Calendrier Tempo global (donnée publique), partagé par tous les foyers (SPEC §7.8). */
export const tempoCalendar = pgTable("tempo_calendar", {
  date: date("date").primaryKey(),
  color: tempoColor("color").notNull(),
  source: text("source", { enum: ["community", "seed"] }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Couleur Tempo propre au foyer : poussée par HA ou corrigée à la main. */
export const tempoOverride = pgTable(
  "tempo_override",
  {
    householdId: householdRef(),
    date: date("date").notNull(),
    color: tempoColor("color").notNull(),
    source: text("source", { enum: ["ha", "manual"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.date] })],
);

/**
 * Combustibles (T24) : achats, relevés de stock et consommations saisis. Les quantités
 * sont stockées dans l'unité saisie (une palette est convertie en sacs à l'enregistrement)
 * et ramenées à l'unité de base à la lecture (src/domain/heating/fuel.ts).
 */
export const fuelEvent = pgTable(
  "fuel_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    fuel: text("fuel", { enum: ["pellet", "wood"] }).notNull(),
    type: text("type", { enum: ["purchase", "stock_snapshot", "consumption"] }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    qty: doublePrecision("qty").notNull(),
    unit: text("unit", { enum: ["bag", "kg", "stere"] }).notNull(),
    priceEur: numeric("price_eur", { precision: 10, scale: 2, mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fuel_event_household_at_idx").on(t.householdId, t.at)],
);

/**
 * Équipements amortis (T28) : un par type et par foyer. Capacité en kWc (solaire) ou en
 * kWh (batterie) ; coût TTC en euros.
 */
export const equipment = pgTable(
  "equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    kind: text("kind", { enum: ["solar", "battery"] }).notNull(),
    label: text("label").notNull(),
    capacity: doublePrecision("capacity"),
    installedOn: date("installed_on").notNull(),
    costEur: numeric("cost_eur", { precision: 10, scale: 2, mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("equipment_household_kind_uq").on(t.householdId, t.kind)],
);

/**
 * Repères : une note datée sur la frise du temps (achat d'un appareil, maintenance,
 * absence…), pour expliquer une hausse ou une baisse de la consommation. Fin facultative
 * (incluse) pour une durée.
 */
export const marker = pgTable(
  "marker",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    kind: text("kind", { enum: ["equipment", "maintenance", "absence", "other"] }).notNull(),
    text: text("text").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("marker_household_start_idx").on(t.householdId, t.startDate)],
);

/** Journal des pushes d'ingestion (conservé 30 jours). */
export const ingestLog = pgTable(
  "ingest_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    httpStatus: integer("http_status").notNull(),
    /**
     * Granularité de l'envoi ; « backfill » : historique (SPEC §6.4) ; « fuel » : décompte
     * d'un combustible (SPEC §6.5).
     */
    mode: text("mode", { enum: ["hourly", "daily", "backfill", "fuel"] }),
    payloadSize: integer("payload_size").notNull(),
    warnings: jsonb("warnings").$type<unknown[]>().notNull().default([]),
    error: text("error"),
  },
  (t) => [index("ingest_log_household_received_idx").on(t.householdId, t.receivedAt)],
);

/**
 * Contrats d'électricité (T18b) : souscrits (datés, sans chevauchement) ou simulés. Le
 * type est fixe ; les prix vivent dans contract_period (historique des grilles).
 */
export const contract = pgTable(
  "contract",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["base", "hphc", "tempo", "custom"] }).notNull(),
    status: text("status", { enum: ["subscribed", "simulated"] })
      .notNull()
      .default("simulated"),
    /** Contrat souscrit : premier jour (inclus). */
    startDate: date("start_date"),
    /** Contrat souscrit terminé : dernier jour (inclus) ; vide = en cours. */
    endDate: date("end_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("contract_household_idx").on(t.householdId)],
);

/** Historique des grilles de prix d'un contrat (T18b) : chacune s'applique de validFrom à la suivante. */
export const contractPeriod = pgTable(
  "contract_period",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contract.id, { onDelete: "cascade" }),
    householdId: householdRef(),
    validFrom: date("valid_from").notNull(),
    /** Grille complète, validée par parseContractInput (src/domain/tariff/schema.ts). */
    config: jsonb("config").$type<Contract>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("contract_period_contract_from_uq").on(t.contractId, t.validFrom)],
);

/**
 * Alertes masquées (T44) : une alerte reste cachée 7 jours, sauf si elle s'aggrave (niveau
 * supérieur) ; la ligne disparaît quand l'alerte n'a plus lieu d'être.
 */
export const alertDismissal = pgTable(
  "alert_dismissal",
  {
    householdId: householdRef(),
    /** Clé de l'alerte (src/domain/alerts.ts), ex. « fuel_stock:pellet ». */
    key: text("key").notNull(),
    level: integer("level").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.key] })],
);

/**
 * Alertes déjà envoyées hors de l'appli (T44 email, T49 push) : une alerte n'est renvoyée que
 * si elle s'aggrave ; la ligne disparaît quand l'alerte n'a plus lieu d'être.
 */
export const alertNotification = pgTable(
  "alert_notification",
  {
    householdId: householdRef(),
    key: text("key").notNull(),
    channel: text("channel", { enum: ["email", "push"] }).notNull(),
    level: integer("level").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.key, t.channel] })],
);

/** Appareils abonnés aux notifications push (T49) : un abonnement par navigateur. */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: householdRef(),
    /** Adresse du service push du navigateur : identifie l'appareil. */
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** Nom lisible de l'appareil (« Chrome sur Android »), pour la liste dans Mon compte. */
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_subscription_household_idx").on(t.householdId)],
);

export const signupModeEnum = pgEnum("signup_mode", ["open", "invite", "closed"]);

/**
 * Réglages de l'instance (une seule ligne, id = 1), modifiés par l'administrateur. Une
 * valeur vide reprend la variable d'environnement (SIGNUP_MODE, INVITE_CODES).
 */
export const instanceSettings = pgTable("instance_settings", {
  id: integer("id").primaryKey().default(1),
  signupMode: signupModeEnum("signup_mode"),
  /** Codes d'invitation, séparés par des virgules. */
  inviteCodes: text("invite_codes"),
  /** Intitulé de l'entrée Contact du menu (T53) ; null : « Contact ». */
  contactLabel: text("contact_label"),
  /** Phrase d'introduction de la page Contact (T53) ; null : phrase neutre. */
  contactIntro: text("contact_intro"),
  /** Texte affiché sous le bouton de soutien de la page Contact (T53) ; null : aucun. */
  contactNotice: text("contact_notice"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const ideaStatus = pgEnum("idea_status", ["new", "planned", "in_progress", "done"]);

/**
 * Boîte à idées (SPEC §9), commune à toute l'instance : hors foyer. Un compte supprimé laisse
 * ses idées, sans auteur (author_id mis à null) ; ses votes partent avec lui.
 */
export const idea = pgTable(
  "idea",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: ideaStatus("status").notNull().default("new"),
    /** Version qui livre l'idée (statut « terminée »). */
    version: text("version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("idea_author_created_idx").on(t.authorId, t.createdAt)],
);

/** Un vote par compte et par idée. */
export const ideaVote = pgTable(
  "idea_vote",
  {
    ideaId: uuid("idea_id")
      .notNull()
      .references(() => idea.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ideaId, t.userId] }), index("idea_vote_user_idx").on(t.userId)],
);

/**
 * Offres du marché (SPEC §7.12) : catalogue global de la source comparateur-abonnements-
 * electricite.fr, remplacé à chaque import. La définition est gardée telle que lue
 * (validée par parseSourceTariff) et convertie en contrat à la lecture, pour qu'une
 * nouvelle prise en charge (saisons, prix spot…) n'exige pas de réimport.
 */
export const marketOffer = pgTable("market_offer", {
  /** Nom de l'offre chez la source (« EDF - Tempo »), identifiant d'un import à l'autre. */
  name: text("name").primaryKey(),
  sourcePath: text("source_path").notNull(),
  definition: jsonb("definition").$type<SourceTariff>().notNull(),
  /** Premier import où l'offre est apparue (conservé d'un import à l'autre). */
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

/** État de la synchronisation du catalogue (une seule ligne, id = 1). */
export const marketSync = pgTable("market_sync", {
  id: integer("id").primaryKey().default(1),
  /** Commit de la source du dernier import réussi. */
  sourceCommit: text("source_commit"),
  sourceCommittedAt: timestamp("source_committed_at", { withTimezone: true }),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  importedAt: timestamp("imported_at", { withTimezone: true }),
  status: text("status", { enum: ["ok", "error"] }),
  /** Dernière erreur (vérification ou import) ; null après un succès. */
  error: text("error"),
});

/** Historique des imports du catalogue (les 20 derniers sont gardés). */
export const marketImport = pgTable(
  "market_import",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    sourceCommit: text("source_commit").notNull(),
    offers: integer("offers").notNull(),
    compared: integer("compared").notNull(),
    added: jsonb("added").$type<string[]>().notNull(),
    removed: jsonb("removed").$type<string[]>().notNull(),
    updated: jsonb("updated").$type<string[]>().notNull(),
    /** Fichiers ou définitions illisibles, avec la raison. */
    unreadable: jsonb("unreadable").$type<string[]>().notNull(),
  },
  (t) => [index("market_import_at_idx").on(t.at)],
);
