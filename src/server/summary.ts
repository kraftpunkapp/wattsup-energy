import { evaluateAlerts } from "@/domain/alerts";
import { buildTimeline, priceTimeline } from "@/domain/tariff/timeline";
import { addDays, localParts } from "@/lib/time";
import { alertFacts, alertSettings } from "./alerts";
import type { HouseholdContext } from "./context";
import { listContracts } from "./contracts";
import { getOverview, gridIntervals } from "./queries/overview";
import { pricingDays } from "./calendars";

// Résumé lisible par Home Assistant (SPEC §6.6, T47) : quelques chiffres prêts à afficher
// dans des capteurs REST, calculés comme dans l'appli. Filtré par le foyer du contexte.

const euros = (cents: number | null) => (cents === null ? null : Math.round(cents) / 100);
const round1 = (v: number) => Math.round(v * 10) / 10;

export interface Summary {
  version: 1;
  generated_at: string;
  cost: {
    /** Électricité du jour et du mois en cours (abonnement compris), en euros ; null sans contrat. */
    today_eur: number | null;
    month_eur: number | null;
    /** Projection de l'année en cours et total de l'an dernier ; null sans base. */
    year_projection_eur: number | null;
    previous_year_eur: number | null;
  };
  /** Combustibles du profil : stock (sacs ou stères) et jours restants au rythme récent. */
  fuel: Record<string, { stock: number; unit: "sacs" | "stères"; days_left: number | null }>;
  /** Alertes en cours (y compris celles masquées dans l'appli). */
  alerts: { key: string; level: number; title: string; text: string }[];
}

export async function getSummary(ctx: HouseholdContext, now = new Date()): Promise<Summary> {
  const today = localParts(now, ctx.timezone).date;
  const tomorrow = addDays(today, 1);
  const [facts, overview, contracts, intervals] = await Promise.all([
    alertFacts(ctx, now),
    getOverview(ctx, undefined, now),
    listContracts(ctx),
    gridIntervals(ctx, today, tomorrow),
  ]);
  const { calendars } = await pricingDays(ctx.householdId, addDays(today, -1), tomorrow, {
    timezone: ctx.timezone,
  });
  const timeline = buildTimeline(contracts, today, tomorrow, today);
  const todayCents = timeline.some((s) => s.contract)
    ? priceTimeline(intervals, timeline, {
        timezone: ctx.timezone,
        ...calendars,
      }).totalCents
    : null;
  const ok = overview.status === "ok" ? overview : null;

  return {
    version: 1,
    generated_at: now.toISOString(),
    cost: {
      today_eur: euros(todayCents),
      month_eur: euros(ok?.budget.totalCents ?? null),
      year_projection_eur: euros(ok?.projection?.totalCents ?? null),
      previous_year_eur: euros(ok?.projection?.previousTotalCents ?? null),
    },
    fuel: Object.fromEntries(
      facts.fuels.map((f) => [
        f.fuel,
        {
          stock: round1(f.fuel === "pellet" ? f.stock / f.bagKg : f.stock),
          unit: f.fuel === "pellet" ? ("sacs" as const) : ("stères" as const),
          days_left: f.dailyUse ? Math.floor(f.stock / f.dailyUse) : null,
        },
      ]),
    ),
    alerts: evaluateAlerts(facts, alertSettings(ctx)).map((a) => ({
      key: a.key,
      level: a.level,
      title: a.title,
      text: a.text,
    })),
  };
}
