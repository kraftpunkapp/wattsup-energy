import { z } from "zod";
import { toSegments } from "../tariff/base-hphc";
import { parseContractInput } from "../tariff/schema";
import type { Contract, CustomContract, CustomRule, TimeRange } from "../tariff/types";
import { findCallArguments, literalAfter, type Literal } from "./literal";

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

const seasonal = z.object({ hiver: z.number().min(0).max(100), ete: z.number().min(0).max(100) });
const spotFormulaSchema = z.object({
  turpe: seasonal,
  accise: z.number().min(0).max(100),
  cap: seasonal.optional(),
  conformite: z.number().min(0).max(100).default(0),
  marge: z.number().min(0).max(100).default(0),
  prime: z.number().min(0).max(100).default(0),
  tva: z.number().min(1).max(1.3),
});

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
  spotFormula: z.unknown().optional(),
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
export type PendingReason = "hourly-data" | "no-spot-prices" | "unknown";

export const REASON_LABELS: Record<PendingReason | "closed", string> = {
  "hourly-data": "prix spot : envoi horaire nécessaire",
  "no-spot-prices": "prix spot pas encore disponibles",
  unknown: "format non reconnu",
  closed: "offre fermée aux nouveaux abonnés",
};

export type OfferSupport =
  | {
      status: "compared";
      kind: Contract["kind"];
      householdOffPeak: boolean;
      /** L'abonné choisit un jour de semaine au prix du week-end (Zen Week-End Plus). */
      chosenDay: boolean;
    }
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
  const chosenDay = hasChosenDay(t);
  const built = build(t, first, null, chosenDay ? CHOOSABLE_DAYS[0] : undefined);
  const support: OfferSupport =
    "contract" in built
      ? {
          status: "compared",
          kind: built.contract.kind,
          householdOffPeak: built.householdOffPeak,
          chosenDay,
        }
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

/** Jours (ISO, du lundi au vendredi) qu'un abonné peut choisir au prix du week-end. */
export const CHOOSABLE_DAYS = [1, 2, 3, 4, 5] as const;
export const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** Nom de l'offre une fois ajoutée aux offres du foyer (jour choisi précisé). */
export function marketContractName(name: string, chosenDay: number | null): string {
  return (chosenDay ? `${name} (${DAY_NAMES[chosenDay - 1]})` : name).slice(0, 60);
}

const hasChosenDay = (t: SourceTariff) =>
  isObject(t.dayRule) && t.dayRule.type === "weekly" && t.dayRule.userDaySetting !== undefined;

/**
 * Contrat de l'offre pour la puissance `kva`, avec les plages creuses du foyer pour une
 * offre à plages libres et, pour une offre à jour choisi, ce jour (`chosenDay`, ISO, requis).
 * null si la puissance n'est pas publiée ou l'offre pas comparable.
 */
export function toContract(
  t: SourceTariff,
  kva: number,
  householdOffPeak: TimeRange[] | null,
  chosenDay?: number,
): MarketContract | null {
  if (!(String(kva) in t.subscriptions)) return null;
  if (hasChosenDay(t) && !CHOOSABLE_DAYS.some((d) => d === chosenDay)) return null;
  const built = build(t, kva, householdOffPeak, chosenDay);
  return "contract" in built ? built : null;
}

type Built = MarketContract | { reason: PendingReason | "closed" };

const ALL_DAY: TimeRange[] = [{ from: "00:00", to: "24:00" }];
const WEEK = [1, 2, 3, 4, 5, 6, 7];
const TEMPO_TYPES = ["bleu", "blanc", "rouge"] as const;
const TYPE_LABELS: Record<string, string> = { weekend: "Week-end", hsc: "Heures super creuses" };

/** Saison d'après ses mois (« Hiver » si elle contient janvier, « Été » si juillet). */
const seasonLabel = (key: string, months: number[]) =>
  months.includes(7) ? "Été" : months.includes(1) ? "Hiver" : key;

/** Créneau d'après le nom du type de la source (hscEte, hpHiver, eteSC…). */
const slotLabel = (type: string): string | null =>
  /^hsc|sc$/i.test(type)
    ? "heures super creuses"
    : /^hp/i.test(type)
      ? "heures pleines"
      : /^hc/i.test(type)
        ? "heures creuses"
        : null;

const isoDay = (d: number) => (d === 0 ? 7 : d);
const dayList = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    ? [...new Set((v as number[]).map(isoDay))].sort()
    : null;
const monthList = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)
    ? (v as number[])
    : null;

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

const rangeList = z.array(
  z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/) }),
);
const rangesSchema = rangeList.min(1);

/**
 * Plages d'un type de jour (`hcRanges.byDayType`), liste vide comprise. Une plage qui finit à
 * « 00:00 » sans commencer à minuit n'est jamais atteinte par le calculateur de la source :
 * elle est ignorée, comme chez elle.
 */
const byDayTypeRanges = (v: unknown): TimeRange[] | null => {
  const r = rangeList.safeParse(v);
  return r.success ? r.data.filter((x) => !(x.to === "00:00" && x.from !== "00:00")) : null;
};

function build(
  t: SourceTariff,
  kva: number,
  household: TimeRange[] | null,
  chosenDay?: number,
): Built {
  const rule = t.dayRule;
  if (!isObject(rule) || typeof rule.type !== "string") return { reason: "unknown" };
  if (rule.type === "spot") {
    // Prix spot (Sobry, T58) : composantes en centimes HT de la source, TVA en multiplicateur.
    const f = t.spotFormula;
    const sp = spotFormulaSchema.safeParse(f);
    if (!sp.success || String(kva) in t.subscriptions === false) return { reason: "unknown" };
    const v = sp.data;
    const contract: Contract = {
      kind: "spot",
      subscriptionEurYear: Math.round((t.subscriptions[String(kva)] as number) * 1200) / 100,
      formula: {
        network: { winter: eur(v.turpe.hiver), summer: eur(v.turpe.ete) },
        excise: eur(v.accise),
        cap: v.cap ? { winter: eur(v.cap.hiver), summer: eur(v.cap.ete) } : null,
        fees: eur(v.conformite + v.marge + v.prime),
        vat: Math.round((v.tva - 1) * 1e4) / 1e4,
      },
    };
    const checked = parseContractInput({ name: t.name.slice(0, 60), contract });
    if (!checked.success) return { reason: "unknown" };
    return { contract: checked.data.contract, householdOffPeak: false, assumedOffPeak: false };
  }
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
      const rest = withOffPeak(main, WEEK, offPeak, {
        hp: "Heures pleines",
        hc: "Heures creuses",
        single: "Autres heures",
      });
      if (!rest) return { reason: "unknown" };
      contract = { kind: "custom", subscriptionEurYear, rules: [...rules, ...rest] };
    }
  } else if (rule.type === "weekly") {
    const days = rule.days;
    if (!isObject(days) || Object.keys(days).length !== 1) return { reason: "unknown" };
    const [type, list] = Object.entries(days)[0] as [string, unknown];
    const listed = dayList(list);
    if (!listed) return { reason: "unknown" };
    // Jour choisi (Zen Week-End Plus) : un jour de semaine de plus au prix du week-end.
    const choosing = rule.userDaySetting !== undefined;
    if (choosing && (chosenDay === undefined || listed.includes(chosenDay))) {
      return { reason: "unknown" };
    }
    const special = choosing ? [...listed, chosenDay as number].sort() : listed;
    const others = WEEK.filter((d) => !special.includes(d));
    const specialSpec = spec(type);
    const defaultSpec = spec(rule.default);
    if (!specialSpec || !defaultSpec) return { reason: "unknown" };
    const label = choosing
      ? `${TYPE_LABELS[type] ?? type} et ${DAY_NAMES[(chosenDay as number) - 1]}`
      : (TYPE_LABELS[type] ?? type);
    const a = withOffPeak(specialSpec, special, offPeak, {
      hp: `${label} HP`,
      hc: `${label} HC`,
      single: label,
    });
    const b = withOffPeak(defaultSpec, others, offPeak, {
      hp: "Semaine HP",
      hc: "Semaine HC",
      single: "Semaine",
    });
    if (!a || !b) return { reason: "unknown" };
    contract = { kind: "custom", subscriptionEurYear, rules: [...a, ...b] };
  } else if (rule.type === "season") {
    const built = seasonRules(rule);
    if ("reason" in built) return built;
    contract = { kind: "custom", subscriptionEurYear, ...built };
  } else if (rule.type === "calendar") {
    if (rule.calendar === "ejp-edf") return { reason: "closed" };
    if (rule.calendar === "zenflex-sobriete") {
      // Zen Flex (T57) : les jours de sobriété, connus par le calendrier importé avec le
      // catalogue, ont leurs propres prix ; les autres jours, ceux de l'offre.
      const sobriety = spec("sobriete");
      const normal = spec(rule.default);
      if (!sobriety || !normal) return { reason: "unknown" };
      const a = withOffPeak(sobriety, WEEK, offPeak, {
        hp: "Jours de sobriété HP",
        hc: "Jours de sobriété HC",
        single: "Jours de sobriété",
      });
      const b = withOffPeak(normal, WEEK, offPeak, {
        hp: "Heures pleines",
        hc: "Heures creuses",
        single: "Autres jours",
      });
      if (!a || !b) return { reason: "unknown" };
      contract = {
        kind: "custom",
        subscriptionEurYear,
        rules: [...a.map((r) => ({ ...r, onlySobrietyDays: true as const })), ...b],
      };
    } else {
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
    }
  } else {
    return { reason: "unknown" };
  }

  // Un contrat accepté doit l'être aussi par l'éditeur : toujours calculable et modifiable.
  const checked = parseContractInput({ name: t.name.slice(0, 60), contract });
  if (!checked.success) return { reason: "unknown" };
  return { contract: checked.data.contract, householdOffPeak, assumedOffPeak };

  /**
   * Règles d'un type de jour sur `days` (et `months`) : prix unique, ou heures creuses puis
   * pleines. Sans plage creuse (liste vide), tout est au prix des heures pleines.
   */
  function withOffPeak(
    s: DayTypeSpec,
    days: number[],
    ranges: () => TimeRange[] | null,
    labels: { hp: string; hc: string; single: string },
    months?: number[],
  ): CustomRule[] | null {
    const m = months ? { months } : {};
    if (days.length === 0) return [];
    const single = (price: number) => [
      { label: labels.single, days, ranges: ALL_DAY, price: eur(price), ...m },
    ];
    if ("price" in s) return single(s.price);
    if (s.HP === s.HC) return single(s.HP);
    const hc = ranges();
    if (!hc) return null;
    if (hc.length === 0) return single(s.HP);
    // Heures creuses toute la journée (week-end Enercoop) : un seul prix.
    if (toSegments(hc).reduce((a, [from, to]) => a + to - from, 0) >= 1440) return single(s.HC);
    return [
      { label: labels.hc, days, ranges: hc, price: eur(s.HC), ...m },
      { label: labels.hp, days, ranges: ALL_DAY, price: eur(s.HP), ...m },
    ];
  }

  /**
   * Tarif à saisons (Zen Estival, Enercoop Flexibilité 2 saisons, Alterna HSC) : pour chaque
   * saison, ses fenêtres horaires propres, son week-end éventuel, puis ses autres heures,
   * restreints à ses mois. « Avant 6 h, c'est la veille » devient `dayStartHour: 6`.
   */
  function seasonRules(
    r: Record<string, unknown>,
  ): Pick<CustomContract, "rules" | "dayStartHour"> | { reason: "unknown" } {
    // Saison et jours d'un calendrier (OctoTempo) : aucune offre de la source ne l'utilise.
    if (r.calendarOverride !== undefined) return { reason: "unknown" };
    if (!isObject(r.seasons)) return { reason: "unknown" };
    const shift = r.previousDayBefore;
    if (shift !== undefined && shift !== 6) return { reason: "unknown" };
    const subTypes = r.hourSubTypes;
    if (subTypes !== undefined && !isObject(subTypes)) return { reason: "unknown" };
    const weekend = r.weekendDays === undefined ? null : dayList(r.weekendDays);
    if (r.weekendDays !== undefined && !weekend) return { reason: "unknown" };
    const hc = t.hcRanges;
    const rangesOf = (type: string) => () =>
      isObject(hc) && isObject(hc.byDayType) ? byDayTypeRanges(hc.byDayType[type]) : offPeak();

    const rules: CustomRule[] = [];
    const push = (more: CustomRule[] | null) => {
      if (!more) return false;
      for (const rule of more) {
        let label = rule.label;
        for (let n = 2; rules.some((x) => x.label === label); n++) label = `${rule.label} ${n}`;
        rules.push({ ...rule, label });
      }
      return true;
    };

    for (const [type, value] of Object.entries(r.seasons)) {
      const months = isObject(value) ? monthList(value.months) : null;
      const main = spec(type);
      if (!months || !main || !isObject(value)) return { reason: "unknown" };
      const season = seasonLabel(type, months);

      // Fenêtres horaires de la saison, regroupées par type (un prix chacun).
      const windows = subTypes?.[type];
      if (windows !== undefined) {
        if (!Array.isArray(windows)) return { reason: "unknown" };
        const byType = new Map<string, TimeRange[]>();
        for (const w of windows as unknown[]) {
          if (!isObject(w) || typeof w.dayType !== "string") return { reason: "unknown" };
          const { fromHour, toHour } = w;
          if (typeof fromHour !== "number" || typeof toHour !== "number") {
            return { reason: "unknown" };
          }
          const list = byType.get(w.dayType) ?? [];
          list.push({ from: hour(fromHour), to: hour(toHour) });
          byType.set(w.dayType, list);
        }
        for (const [subType, ranges] of byType) {
          const s = spec(subType);
          if (!s || !("price" in s)) return { reason: "unknown" };
          const slot = slotLabel(subType) ?? `${ranges[0]?.from.slice(0, 2)} h`;
          push([{ label: `${season} ${slot}`, days: WEEK, ranges, price: eur(s.price), months }]);
        }
      }

      // Week-end de la saison, puis les autres jours.
      let days = WEEK;
      if (value.weekendType !== undefined) {
        const w = spec(value.weekendType);
        if (!weekend || !w || typeof value.weekendType !== "string") return { reason: "unknown" };
        const label = `${season} week-end`;
        const ok = push(
          withOffPeak(
            w,
            weekend,
            rangesOf(value.weekendType),
            { hp: `${label} HP`, hc: `${label} HC`, single: label },
            months,
          ),
        );
        if (!ok) return { reason: "unknown" };
        days = WEEK.filter((d) => !weekend.includes(d));
      }
      const hint = "price" in main ? slotLabel(type) : null;
      const label = hint ? `${season} ${hint}` : season;
      const ok = push(
        withOffPeak(
          main,
          days,
          rangesOf(type),
          {
            hp: `${label} HP`,
            hc: `${label} HC`,
            single: label,
          },
          months,
        ),
      );
      if (!ok) return { reason: "unknown" };
    }
    return { rules, ...(shift === 6 ? { dayStartHour: 6 as const } : {}) };
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

/** Calendrier des jours de sobriété Zen Flex dans le dépôt de la source (T57). */
export const SOBRIETY_CALENDAR_PATH = "scripts/tarifs-lib/calendars/zenflex-sobriete.js";

/**
 * Jours de sobriété (AAAA-MM-JJ, croissants) du calendrier de la source :
 * `defineCalendar("zenflex-sobriete", { sobriete: { days: ["AAAA/MM/JJ", …] } })`.
 */
export function parseSobrietyCalendar(src: string): string[] {
  const call = findCallArguments(src, "defineCalendar").find(
    (c) => c.ok && c.args[0] === "zenflex-sobriete",
  );
  if (!call?.ok) throw new Error("calendrier Zen Flex introuvable");
  const body = call.args[1];
  const days = isObject(body) && isObject(body.sobriete) ? body.sobriete.days : null;
  if (!Array.isArray(days)) throw new Error("calendrier Zen Flex : liste de jours attendue");
  const out = new Set<string>();
  for (const d of days) {
    if (typeof d !== "string" || !/^\d{4}\/\d{2}\/\d{2}$/.test(d)) {
      throw new Error(`calendrier Zen Flex : date invalide ${String(d)}`);
    }
    out.add(d.replaceAll("/", "-"));
  }
  return [...out].sort();
}
