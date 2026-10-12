import { z } from "zod";
import { toSegments } from "./base-hphc";
import { validateCustomRules } from "./custom";
import { SUMMER_MONTHS, WINTER_MONTHS } from "./seasons";
import type { Contract } from "./types";

// Validation des contrats saisis dans l'éditeur (T17). Prix TTC en €/kWh, abonnement
// TTC en €/an. Les règles métier (plages, couverture d'un contrat sur mesure) réutilisent
// celles du moteur tarifaire, pour qu'un contrat accepté soit toujours calculable.

const price = z.number().positive("prix attendu supérieur à 0").max(5, "prix au kWh trop élevé");
const subscription = z.number().min(0).max(10_000);
const hm = z.string().regex(/^\d{2}:\d{2}$/, "format HH:MM attendu");
const range = z.object({ from: hm, to: hm });

const checkRanges = (ranges: { from: string; to: string }[], ctx: z.RefinementCtx) => {
  try {
    toSegments(ranges);
  } catch (err) {
    ctx.addIssue({ code: "custom", message: (err as Error).message });
  }
};

const base = z.object({
  kind: z.literal("base"),
  subscriptionEurYear: subscription,
  priceEurKwh: price,
});

const hphc = z.object({
  kind: z.literal("hphc"),
  subscriptionEurYear: subscription,
  prices: z.object({ hp: price, hc: price }),
  hcRanges: z.array(range).min(1, "au moins une plage d'heures creuses").superRefine(checkRanges),
});

const slotPrices = z.object({ hp: price, hc: price });
const tempo = z.object({
  kind: z.literal("tempo"),
  subscriptionEurYear: subscription,
  prices: z.object({ bleu: slotPrices, blanc: slotPrices, rouge: slotPrices }),
});

const custom = z.object({
  kind: z.literal("custom"),
  subscriptionEurYear: subscription,
  dayStartHour: z.union([z.literal(0), z.literal(6)]).optional(),
  rules: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        days: z.array(z.number().int()),
        ranges: z.array(range).min(1),
        price,
        months: z.array(z.number().int()).max(12).optional(),
        onlySobrietyDays: z.literal(true).optional(),
      }),
    )
    .superRefine((rules, ctx) => {
      for (const message of validateCustomRules(rules)) ctx.addIssue({ code: "custom", message });
    }),
});

const component = z.number().min(-1).max(5);
const seasonal = z.object({ winter: component, summer: component });
const spot = z.object({
  kind: z.literal("spot"),
  subscriptionEurYear: subscription,
  formula: z.object({
    network: seasonal,
    excise: component,
    cap: seasonal.nullable(),
    fees: component,
    vat: z.number().min(0).max(0.3),
  }),
});

const contractSchema = z.discriminatedUnion("kind", [base, hphc, tempo, custom, spot]);

const inputSchema = z.object({
  name: z.string().trim().min(1, "nom requis").max(60),
  contract: contractSchema,
});

export interface ContractInput {
  name: string;
  contract: Contract;
}

export type ParseContractResult =
  | { success: true; data: ContractInput }
  | { success: false; errors: { path: string; message: string }[] };

export function parseContractInput(input: unknown): ParseContractResult {
  const r = inputSchema.safeParse(input);
  if (r.success) return { success: true, data: r.data };
  return {
    success: false,
    errors: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

const ALL_DAY = [{ from: "00:00", to: "24:00" }];
const WEEK = [1, 2, 3, 4, 5, 6, 7];
const NIGHT = [{ from: "22:00", to: "06:00" }];

/**
 * Offres de référence pour démarrer la saisie : grilles TTC indicatives (puissance
 * 9 kVA, maquette), à vérifier sur sa facture. Elles ne sont jamais présentées comme
 * des tarifs officiels à jour.
 */
export const CONTRACT_PRESETS: readonly ContractInput[] = [
  {
    name: "Tarif Base",
    contract: { kind: "base", subscriptionEurYear: 229.2, priceEurKwh: 0.2516 },
  },
  {
    name: "Heures creuses",
    contract: {
      kind: "hphc",
      subscriptionEurYear: 236.4,
      prices: { hp: 0.27, hc: 0.2068 },
      hcRanges: [{ from: "22:00", to: "06:00" }],
    },
  },
  {
    name: "Tempo",
    contract: {
      kind: "tempo",
      subscriptionEurYear: 230.04,
      prices: {
        bleu: { hc: 0.1288, hp: 0.1552 },
        blanc: { hc: 0.1447, hp: 0.1792 },
        rouge: { hc: 0.1518, hp: 0.6586 },
      },
    },
  },
  {
    name: "Week-end réduit",
    contract: {
      kind: "custom",
      subscriptionEurYear: 232.8,
      rules: [
        { label: "Week-end", days: [6, 7], ranges: ALL_DAY, price: 0.1876 },
        { label: "Semaine", days: [1, 2, 3, 4, 5], ranges: ALL_DAY, price: 0.2489 },
      ],
    },
  },
  {
    // T56 : un jour choisi par l'abonné (ici le mercredi) au prix du week-end.
    name: "Week-end + 1 jour",
    contract: {
      kind: "custom",
      subscriptionEurYear: 238.56,
      rules: [
        { label: "Week-end et jour choisi", days: [3, 6, 7], ranges: ALL_DAY, price: 0.1691 },
        { label: "Autres jours", days: [1, 2, 4, 5], ranges: ALL_DAY, price: 0.2259 },
      ],
    },
  },
  {
    // T58 : prix indexé sur le marché spot (grille Sobry SoCap, 9 kVA), composantes HT.
    name: "Prix spot",
    contract: {
      kind: "spot",
      subscriptionEurYear: 331.53,
      formula: {
        network: { winter: 0.0632, summer: 0.0149 },
        excise: 0.03085,
        cap: { winter: 0.25, summer: 0.1417 },
        fees: 0.025,
        vat: 0.2,
      },
    },
  },
  {
    // T56 : prix d'hiver (novembre à mars) et d'été (avril à octobre), heures creuses la nuit.
    name: "Saisons",
    contract: {
      kind: "custom",
      subscriptionEurYear: 238.56,
      dayStartHour: 6,
      rules: [
        { label: "Hiver HC", days: WEEK, ranges: NIGHT, price: 0.2131, months: WINTER_MONTHS },
        { label: "Hiver HP", days: WEEK, ranges: ALL_DAY, price: 0.2722, months: WINTER_MONTHS },
        { label: "Été HC", days: WEEK, ranges: NIGHT, price: 0.1405, months: SUMMER_MONTHS },
        { label: "Été HP", days: WEEK, ranges: ALL_DAY, price: 0.1588, months: SUMMER_MONTHS },
      ],
    },
  },
];
