import { z } from "zod";

// Contrat d'ingestion v1 (SPEC §6). Toute rupture impose version: 2.

const kwh = z.number().nonnegative();

/** Slug d'un poste de consommation : clé du bloc `categories`. */
export const categorySlug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug attendu : minuscules, chiffres et tirets");

export const tempoColor = z.enum(["bleu", "blanc", "rouge"]);

const categories = z.record(categorySlug, kwh);

const hourlySchema = z.object({
  version: z.literal(1),
  ts: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  energy: z
    .object({
      grid_import_kwh: kwh,
      grid_export_kwh: kwh,
      solar_production_kwh: kwh,
      battery_charge_kwh: kwh,
      battery_charge_grid_kwh: kwh,
      battery_discharge_kwh: kwh,
    })
    .partial()
    .optional(),
  categories: categories.optional(),
  tempo_color: tempoColor.optional(),
  /** Niveau de la batterie au moment de l'envoi, en % (T78, facultatif). */
  battery_soc_percent: z.number().min(0).max(100).optional(),
  fuel: z
    .object({
      pellet_bags_total: z.number().nonnegative(),
      wood_steres_total: z.number().nonnegative(),
    })
    .partial()
    .optional(),
});

const dailySchema = z.object({
  version: z.literal(1),
  date: z.iso.date(),
  // Contrat Base : un total. Contrat HP/HC ou Tempo : les deux créneaux.
  grid_import: z
    .union([z.strictObject({ kwh }), z.strictObject({ hp_kwh: kwh, hc_kwh: kwh })])
    .optional(),
  grid_export_kwh: kwh.optional(),
  solar_production_kwh: kwh.optional(),
  battery_charge_kwh: kwh.optional(),
  battery_charge_grid_kwh: kwh.optional(),
  battery_discharge_kwh: kwh.optional(),
  categories: categories.optional(),
  tempo_color: tempoColor.optional(),
  fuel: z
    .object({ pellet_bags: z.number().nonnegative(), wood_steres: z.number().nonnegative() })
    .partial()
    .optional(),
});

export type HourlyPayload = z.output<typeof hourlySchema> & { kind: "hourly" };
export type DailyPayload = z.output<typeof dailySchema> & { kind: "daily" };
export type IngestPayload = HourlyPayload | DailyPayload;

export interface PayloadError {
  /** Chemin pointé du champ fautif, ex. "energy.grid_import_kwh" ; vide pour la racine. */
  path: string;
  message: string;
}

export type ParseResult =
  { success: true; data: IngestPayload } | { success: false; errors: PayloadError[] };

const rootError = (message: string): ParseResult => ({
  success: false,
  errors: [{ path: "", message }],
});

/**
 * Valide un corps JSON d'ingestion. Le mode est déterminé par la présence de `ts`
 * (horaire) ou de `date` (quotidien), jamais les deux.
 */
export function parseIngestPayload(json: unknown): ParseResult {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return rootError("objet JSON attendu");
  }
  const hasTs = "ts" in json;
  const hasDate = "date" in json;
  if (hasTs === hasDate) {
    return rootError("fournir soit `ts` (mode horaire), soit `date` (mode quotidien)");
  }

  const result = hasTs ? hourlySchema.safeParse(json) : dailySchema.safeParse(json);
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  const kind = hasTs ? "hourly" : "daily";
  return { success: true, data: { ...result.data, kind } as IngestPayload };
}
