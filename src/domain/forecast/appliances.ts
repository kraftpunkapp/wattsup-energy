import { z } from "zod";
import type { Appliance } from "./windows";

// Appareils déplaçables (T71, SPEC §7.14) : ceux dont on peut choisir l'heure. Liste type
// proposée, puis modifiable ; WattsUp cherche pour chacun le créneau le moins cher. Pur.

export const APPLIANCE_ICONS = [
  "washer",
  "plug",
  "droplet",
  "car",
  "flame",
  "snowflake",
  "waves",
] as const;
export type ApplianceIcon = (typeof APPLIANCE_ICONS)[number];

export type ApplianceInput = Omit<Appliance, "id"> & { icon: ApplianceIcon };

/** Appareils au plus par foyer. */
export const MAX_APPLIANCES = 10;

export const APPLIANCE_PRESETS: ApplianceInput[] = [
  {
    name: "Lave-linge",
    icon: "washer",
    powerKw: 2,
    durationMin: 120,
    allowedFrom: 8,
    allowedTo: 22,
  },
  {
    name: "Lave-vaisselle",
    icon: "plug",
    powerKw: 1.5,
    durationMin: 120,
    allowedFrom: 0,
    allowedTo: 0,
  },
  {
    name: "Ballon d'eau chaude",
    icon: "droplet",
    powerKw: 2.4,
    durationMin: 180,
    allowedFrom: 0,
    allowedTo: 0,
  },
  {
    name: "Recharge du véhicule",
    icon: "car",
    powerKw: 3.7,
    durationMin: 240,
    allowedFrom: 0,
    allowedTo: 0,
  },
];

const hour = (message: string) =>
  z.number({ error: message }).int(message).min(0, message).max(23, message);
const schema = z.object({
  name: z.string().trim().min(1, "nom requis").max(40, "nom trop long (40 caractères au plus)"),
  icon: z.enum(APPLIANCE_ICONS, { error: "icône inconnue" }),
  powerKw: z
    .union([z.number(), z.string()])
    .transform((v) => Number(String(v).replace(",", ".").trim()))
    .refine((v) => Number.isFinite(v) && v >= 0.1 && v <= 22, "puissance entre 0,1 et 22 kW"),
  durationMin: z
    .number({ error: "durée au quart d'heure, de 15 min à 12 h" })
    .refine(
      (v) => Number.isInteger(v) && v % 15 === 0 && v >= 15 && v <= 720,
      "durée au quart d'heure, de 15 min à 12 h",
    ),
  allowedFrom: hour("heure de début invalide"),
  allowedTo: hour("heure de fin invalide"),
});

export function parseAppliance(
  raw: unknown,
): { ok: true; value: ApplianceInput } | { ok: false; errors: string[] } {
  const r = schema.safeParse(raw);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, errors: r.error.issues.map((i) => i.message) };
}

const kw = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
export const durationLabel = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m}`;
};

/** « 2 kW · 2 h · de 8 h à 22 h ». */
export function describeAppliance(
  a: Pick<Appliance, "powerKw" | "durationMin" | "allowedFrom" | "allowedTo">,
) {
  const range =
    a.allowedFrom === a.allowedTo ? "à toute heure" : `de ${a.allowedFrom} h à ${a.allowedTo} h`;
  return `${kw(a.powerKw)} kW · ${durationLabel(a.durationMin)} · ${range}`;
}
