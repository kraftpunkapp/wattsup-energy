import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { sobrietyDay, sobrietyOverride } from "@/db/schema";
import type { PricingContext, TempoColor } from "@/domain/tariff/types";
import { tempoColorsFor } from "./tempo/sync";

// Calendriers qui modulent les prix (SPEC §7.8, §7.12) : couleurs Tempo et jours de sobriété
// EDF Zen Flex (T57). Chaque calendrier global peut être corrigé par le foyer ; tous les
// calculs de coût passent par ici pour en tenir compte de la même façon.

/** Jours de sobriété de [from, to] : calendrier importé, puis corrections du foyer. */
export async function sobrietyDaysFor(
  householdId: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const [global, overrides] = await Promise.all([
    db
      .select({ date: sobrietyDay.date })
      .from(sobrietyDay)
      .where(and(gte(sobrietyDay.date, from), lte(sobrietyDay.date, to))),
    sobrietyOverrides(householdId, from, to),
  ]);
  const days = new Set(global.map((r) => r.date));
  for (const o of overrides) {
    if (o.sobriety) days.add(o.date);
    else days.delete(o.date);
  }
  return days;
}

function sobrietyOverrides(householdId: string, from: string, to: string) {
  return db
    .select({ date: sobrietyOverride.date, sobriety: sobrietyOverride.sobriety })
    .from(sobrietyOverride)
    .where(
      and(
        eq(sobrietyOverride.householdId, householdId),
        gte(sobrietyOverride.date, from),
        lte(sobrietyOverride.date, to),
      ),
    );
}

export interface PricingDays {
  colors: Map<string, TempoColor>;
  sobriety: Set<string>;
  /** À fusionner dans un contexte de calcul (`PricingContext`). */
  calendars: Pick<PricingContext, "tempoColor" | "sobrietyDay">;
}

/** Couleurs Tempo et jours de sobriété du foyer sur [from, to], prêts pour le moteur. */
export async function pricingDays(
  householdId: string,
  from: string,
  to: string,
): Promise<PricingDays> {
  const [colors, sobriety] = await Promise.all([
    tempoColorsFor(householdId, from, to),
    sobrietyDaysFor(householdId, from, to),
  ]);
  return {
    colors,
    sobriety,
    calendars: { tempoColor: (d) => colors.get(d), sobrietyDay: (d) => sobriety.has(d) },
  };
}

/** Jours [from, to] du calendrier Zen Flex avec leur provenance, pour l'écran Contrats. */
export async function sobrietyCalendarView(householdId: string, from: string, to: string) {
  const [global, overrides] = await Promise.all([
    db
      .select({ date: sobrietyDay.date })
      .from(sobrietyDay)
      .where(and(gte(sobrietyDay.date, from), lte(sobrietyDay.date, to))),
    sobrietyOverrides(householdId, from, to),
  ]);
  const days = new Map<string, { sobriety: boolean; source: "manual" | "calendar" }>();
  for (const r of global) days.set(r.date, { sobriety: true, source: "calendar" });
  for (const o of overrides) days.set(o.date, { sobriety: o.sobriety, source: "manual" });
  return days;
}

/** Correction manuelle d'un jour (null : retire la correction, le calendrier reprend la main). */
export async function setManualSobriety(
  householdId: string,
  date: string,
  sobriety: boolean | null,
) {
  if (sobriety === null) {
    await db
      .delete(sobrietyOverride)
      .where(and(eq(sobrietyOverride.householdId, householdId), eq(sobrietyOverride.date, date)));
    return;
  }
  await db
    .insert(sobrietyOverride)
    .values({ householdId, date, sobriety })
    .onConflictDoUpdate({
      target: [sobrietyOverride.householdId, sobrietyOverride.date],
      set: { sobriety },
    });
}
