import { z } from "zod";
import { toSegments } from "../tariff/base-hphc";
import { parseContractInput } from "../tariff/schema";
import type { Contract, CustomRule, TimeRange } from "../tariff/types";
import { literalAfter, type Literal } from "./literal";

// Offres du marché (SPEC §7.12) : définitions de la source comparateur-abonnements-
// electricite.fr (dépôt JC144/EDF_Simulateur_Prix), lues sans exécution, puis converties
// en contrats du moteur tarifaire pour une puissance donnée. Prix de la source : abonnement
// en €/mois par puissance, kWh en centimes TTC ; contrats du moteur : €/an et €/kWh.

/** Chemins des fichiers de tarifs listés par le manifeste (format de chemin contrôlé). */
const TARIFF_PATH = /^scripts\/tarifs\/[a-z0-9_-]+\/[A-Za-z0-9_-]+\.js$/;

export function parseManifest(src: string): string[] {
  const list = literalAfter(src, "TARIF_SCRIPTS");
  if (!Array.isArray(list)) throw new Error("manifeste : liste de fichiers attendue");
  return [
    ...new Set(list.filter((p): p is string => typeof p === "string" && TARIFF_PATH.test(p))),
  ];
}

const price = z.number().positive().max(500); // centimes/kWh
const dayTypeSpec = z.union([
  z.object({ price }).strict(),
  z.object({ HP: price, HC: price }).strict(),
]);
type DayTypeSpec = z.infer<typeof dayTypeSpec>;

const tariffSchema = z.looseObject({
  name: z.string().trim().min(3).max(80),
  offer_type: z.string().max(20),
  lastUpdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  subscription_url: z.string().max(500).optional(),
  price_url: z.string().max(500).optional(),
  subscriptions: z.record(z.string().regex(/^\d{1,2}$/), z.number().positive().max(500)),
  dayTypes: z.record(z.string().max(40), dayTypeSpec).optional(),
  priceOverrides: z.record(z.string(), z.record(z.string(), dayTypeSpec)).optional(),
  dayRule: z.unknown().optional(),
  hcRanges: z.unknown().optional(),
});

export type SourceTariff = z.infer<typeof tariffSchema>;

/** Définition lue dans un fichier de la source ; message en français si elle est inutilisable. */
export function parseSourceTariff(
  value: Literal | unknown,
): { ok: true; tariff: SourceTariff } | { ok: false; error: string } {
  const r = tariffSchema.safeParse(value);
  if (r.success && Object.keys(r.data.subscriptions).length > 0)
    return { ok: true, tariff: r.data };
  const issue = r.success ? null : r.error.issues[0];
  return {
    ok: false,
    error: issue
      ? `${issue.path.join(".") || "définition"} : ${issue.message}`
      : "aucune puissance",
  };
}

/** Raison pour laquelle une offre n'est pas (encore) comparée. */
export type PendingReason = "seasons" | "chosen-day" | "special-days" | "spot" | "unknown";

export const REASON_LABELS: Record<PendingReason | "closed", string> = {
  seasons: "prix selon la saison",
  "chosen-day": "jour choisi par l'abonné",
  "special-days": "jours spéciaux (Zen Flex)",
  spot: "prix spot",
  unknown: "format non reconnu",
  closed: "offre fermée aux nouveaux abonnés",
};

export type OfferSupport =
  | { status: "compared"; kind: Contract["kind"]; householdOffPeak: boolean }
  | { status: "pending"; reason: PendingReason }
  | { status: "never"; reason: "closed" };

export interface OfferInfo {
  provider: string;
  offer: string;
  regulated: boolean;
  /** Date de la grille de prix (AAAA-MM-JJ). */
  gridDate: string;
  /** Puissances publiées, en kVA, croissantes. */
  powers: number[];
  support: OfferSupport;
}

/** « EDF - Bleu Heures Creuses » → fournisseur « EDF », offre « Bleu Heures Creuses ». */
export function splitName(name: string): { provider: string; offer: string } {
  const at = name.indexOf(" - ");
  return at === -1
    ? { provider: name, offer: name }
    : { provider: name.slice(0, at).trim(), offer: name.slice(at + 3).trim() };
}

export function describeOffer(t: SourceTariff): OfferInfo {
  const powers = Object.keys(t.subscriptions)
    .map(Number)
    .sort((a, b) => a - b);
  const first = powers[0] as number;
  const built = build(t, first, null);
  const support: OfferSupport =
    "contract" in built
      ? { status: "compared", kind: built.contract.kind, householdOffPeak: built.householdOffPeak }
      : built.reason === "closed"
        ? { status: "never", reason: "closed" }
        : { status: "pending", reason: built.reason };
  return {
    ...splitName(t.name),
    regulated: t.offer_type === "TRV",
    gridDate: t.lastUpdate,
    powers,
    support,
  };
}

export interface MarketContract {
  contract: Contract;
  /** Heures creuses libres prises sur le foyer (ou supposées si `assumedOffPeak`). */
  householdOffPeak: boolean;
  /** Plages libres sans plages connues du foyer : 22 h – 6 h supposées. */
  assumedOffPeak: boolean;
}

/** Plages creuses supposées quand l'offre laisse le choix et que le foyer n'en a pas. */
export const DEFAULT_OFF_PEAK: TimeRange[] = [{ from: "22:00", to: "06:00" }];

/**
 * Contrat de l'offre pour la puissance `kva`, avec les plages creuses du foyer pour une
 * offre à plages libres. null si la puissance n'est pas publiée ou l'offre pas comparable.
 */
export function toContract(
  t: SourceTariff,
  kva: number,
  householdOffPeak: TimeRange[] | null,
): MarketContract | null {
  if (!(String(kva) in t.subscriptions)) return null;
  const built = build(t, kva, householdOffPeak);
  return "contract" in built ? built : null;
}

type Built = MarketContract | { reason: PendingReason | "closed" };

const ALL_DAY: TimeRange[] = [{ from: "00:00", to: "24:00" }];
const WEEK = [1, 2, 3, 4, 5, 6, 7];
const TEMPO_TYPES = ["bleu", "blanc", "rouge"] as const;
const TYPE_LABELS: Record<string, string> = { weekend: "Week-end", hsc: "Heures super creuses" };

const eur = (cents: number) => Math.round(cents * 1e4) / 1e6;
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const sameSegments = (a: TimeRange[], b: TimeRange[]) => {
  const norm = (r: TimeRange[]) =>
    JSON.stringify(
      toSegments(r)
        .sort((x, y) => x[0] - y[0])
        .reduce<[number, number][]>((acc, s) => {
          const last = acc[acc.length - 1];
          if (last && last[1] === s[0]) last[1] = s[1];
          else acc.push([...s]);
          return acc;
        }, []),
    );
  return norm(a) === norm(b);
};

const rangesSchema = z
  .array(
    z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) }),
  )
  .min(1);

function build(t: SourceTariff, kva: number, household: TimeRange[] | null): Built {
  const rule = t.dayRule;
  if (!isObject(rule) || typeof rule.type !== "string") return { reason: "unknown" };
  if (rule.type === "spot") return { reason: "spot" };
  if (rule.type === "season") return { reason: "seasons" };
  if (!t.dayTypes) return { reason: "unknown" };

  const spec = (type: unknown): DayTypeSpec | undefined =>
    typeof type === "string"
      ? (t.priceOverrides?.[String(kva)]?.[type] ?? t.dayTypes?.[type])
      : undefined;

  // Plages creuses : fixes (liste), libres (« custom » : celles du foyer) ou absentes.
  let householdOffPeak = false;
  let assumedOffPeak = false;
  const offPeak = (): TimeRange[] | null => {
    if (t.hcRanges === "custom") {
      householdOffPeak = true;
      if (household && household.length > 0) return household;
      assumedOffPeak = true;
      return DEFAULT_OFF_PEAK;
    }
    const r = rangesSchema.safeParse(t.hcRanges);
    return r.success ? r.data : null;
  };

  const subscriptionEurYear = Math.round((t.subscriptions[String(kva)] as number) * 1200) / 100;
  let contract: Contract | null = null;

  if (rule.type === "constant") {
    const main = spec(rule.dayType);
    if (!main) return { reason: "unknown" };
    if (rule.hourSubTypes === undefined) {
      // HP = HC (Alpiq Base) : un prix unique, quelles que soient les plages.
      if ("price" in main || main.HP === main.HC) {
        const single = "price" in main ? main.price : main.HP;
        contract = { kind: "base", subscriptionEurYear, priceEurKwh: eur(single) };
      } else {
        const hcRanges = offPeak();
        if (!hcRanges) return { reason: "unknown" };
        contract = {
          kind: "hphc",
          subscriptionEurYear,
          prices: { hp: eur(main.HP), hc: eur(main.HC) },
          hcRanges,
        };
      }
    } else {
      // Fenêtres horaires à prix propre (heures super creuses), prioritaires sur le reste.
      if (!Array.isArray(rule.hourSubTypes)) return { reason: "unknown" };
      const rules: CustomRule[] = [];
      for (const sub of rule.hourSubTypes as unknown[]) {
        if (!isObject(sub)) return { reason: "unknown" };
        const { fromHour, toHour, dayType } = sub;
        const s = spec(dayType);
        if (typeof fromHour !== "number" || typeof toHour !== "number" || !s || !("price" in s)) {
          return { reason: "unknown" };
        }
        const label = TYPE_LABELS[dayType as string] ?? `${fromHour} h – ${toHour} h`;
        rules.push({
          label: rules.some((r) => r.label === label) ? `${label} (${fromHour} h)` : label,
          days: WEEK,
          ranges: [{ from: hour(fromHour), to: hour(toHour) }],
          price: eur(s.price),
        });
      }
      const rest = withOffPeak(main, WEEK, "Heures pleines", "Heures creuses", "Autres heures");
      if (!rest) return { reason: "unknown" };
      contract = { kind: "custom", subscriptionEurYear, rules: [...rules, ...rest] };
    }
  } else if (rule.type === "weekly") {
    if (rule.userDaySetting !== undefined) return { reason: "chosen-day" };
    const days = rule.days;
    if (!isObject(days) || Object.keys(days).length !== 1) return { reason: "unknown" };
    const [type, list] = Object.entries(days)[0] as [string, unknown];
    if (!Array.isArray(list) || list.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return { reason: "unknown" };
    }
    const special = [...new Set((list as number[]).map((d) => (d === 0 ? 7 : d)))].sort();
    const others = WEEK.filter((d) => !special.includes(d));
    const specialSpec = spec(type);
    const defaultSpec = spec(rule.default);
    if (!specialSpec || !defaultSpec) return { reason: "unknown" };
    const label = TYPE_LABELS[type] ?? type;
    const a = withOffPeak(specialSpec, special, `${label} HP`, `${label} HC`, label);
    const b = withOffPeak(defaultSpec, others, "Semaine HP", "Semaine HC", "Semaine");
    if (!a || !b) return { reason: "unknown" };
    contract = { kind: "custom", subscriptionEurYear, rules: [...a, ...b] };
  } else if (rule.type === "calendar") {
    if (rule.calendar === "ejp-edf") return { reason: "closed" };
    if (rule.calendar === "zenflex-sobriete") return { reason: "special-days" };
    if (rule.calendar !== "tempo-edf" || rule.default !== "bleu") return { reason: "unknown" };
    const ranges = rangesSchema.safeParse(t.hcRanges);
    if (!ranges.success || !sameSegments(ranges.data, DEFAULT_OFF_PEAK)) {
      return { reason: "unknown" };
    }
    const prices = {} as Record<(typeof TEMPO_TYPES)[number], { hp: number; hc: number }>;
    for (const color of TEMPO_TYPES) {
      const s = spec(color);
      if (!s || "price" in s) return { reason: "unknown" };
      prices[color] = { hp: eur(s.HP), hc: eur(s.HC) };
    }
    contract = { kind: "tempo", subscriptionEurYear, prices };
  } else {
    return { reason: "unknown" };
  }

  // Un contrat accepté doit l'être aussi par l'éditeur : toujours calculable et modifiable.
  const checked = parseContractInput({ name: t.name.slice(0, 60), contract });
  if (!checked.success) return { reason: "unknown" };
  return { contract: checked.data.contract, householdOffPeak, assumedOffPeak };

  /** Règles d'un type de jour sur `days` : prix unique, ou heures creuses puis pleines. */
  function withOffPeak(
    s: DayTypeSpec,
    days: number[],
    hpLabel: string,
    hcLabel: string,
    singleLabel: string,
  ): CustomRule[] | null {
    if (days.length === 0) return [];
    if ("price" in s) return [{ label: singleLabel, days, ranges: ALL_DAY, price: eur(s.price) }];
    if (s.HP === s.HC) return [{ label: singleLabel, days, ranges: ALL_DAY, price: eur(s.HP) }];
    const ranges = offPeak();
    if (!ranges) return null;
    return [
      { label: hcLabel, days, ranges, price: eur(s.HC) },
      { label: hpLabel, days, ranges: ALL_DAY, price: eur(s.HP) },
    ];
  }
}

/** Texte stable d'une définition (clés triées) : deux grilles identiques donnent le même. */
export function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    isObject(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}

export interface CatalogDiff {
  added: string[];
  removed: string[];
  updated: string[];
}

/** Offres nouvelles, retirées et modifiées entre deux catalogues (par nom). */
export function diffCatalogs(
  previous: readonly { name: string; definition: unknown }[],
  next: readonly { name: string; definition: unknown }[],
): CatalogDiff {
  const before = new Map(previous.map((o) => [o.name, fingerprint(o.definition)]));
  const after = new Map(next.map((o) => [o.name, fingerprint(o.definition)]));
  const sort = (names: string[]) => names.sort((a, b) => a.localeCompare(b, "fr"));
  return {
    added: sort([...after.keys()].filter((n) => !before.has(n))),
    removed: sort([...before.keys()].filter((n) => !after.has(n))),
    updated: sort(
      [...after].filter(([n, f]) => before.has(n) && before.get(n) !== f).map(([n]) => n),
    ),
  };
}

const DAY_MS = 86_400_000;

/** Grille de plus de 6 mois (date AAAA-MM-JJ, `today` local) : à signaler comme ancienne. */
export function isOldGrid(gridDate: string, today: string): boolean {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const limit = new Date(Date.UTC(y, m - 1 - 6, d)).toISOString().slice(0, 10);
  return gridDate < limit;
}

/**
 * Offre apparue depuis moins de 30 jours, hors catalogue d'origine : `catalogStart` est la
 * plus ancienne première apparition (le premier import ne marque rien comme nouveau).
 */
export function isNewOffer(firstSeen: Date, catalogStart: Date, now: Date): boolean {
  return (
    firstSeen.getTime() > catalogStart.getTime() &&
    now.getTime() - firstSeen.getTime() < 30 * DAY_MS
  );
}
