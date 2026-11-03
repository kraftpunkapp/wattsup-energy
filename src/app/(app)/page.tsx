import {
  BudgetCard,
  CheaperContractNotice,
  OriginCard,
  PaymentBanner,
  PeriodSwitcher,
} from "@/components/cards/overview-cards";
import {
  BaseloadInsight,
  CategoriesInsight,
  PeakInsight,
  SolarInsight,
} from "@/components/cards/insights";
import { BatteryGapNotices } from "@/components/battery-gap-notice";
import { AdviceCard, windowTips } from "@/components/cards/advice-card";
import { AlertsCard } from "@/components/cards/alerts-card";
import { MarkersStrip } from "@/components/cards/markers-strip";
import { Icon } from "@/components/ui";
import { PeriodContent, PeriodTransition } from "@/components/period-transition";
import { MonthlyCostCard } from "@/components/cards/monthly-cost-card";
import { MonthlyTable } from "@/components/cards/monthly-table";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { HideButton, Hideable } from "@/components/overview/hideable";
import { OVERVIEW_BLOCKS, type OverviewBlock } from "@/domain/overview-blocks";
import { visibleModules } from "@/domain/profile";
import { settingsHref } from "@/lib/settings-tabs";
import { localParts } from "@/lib/time";
import { getAdvice } from "@/server/advice";
import { getAlerts } from "@/server/alerts";
import { getLastPushAt } from "@/server/ingest/status";
import { shareInFlight } from "@/server/inflight";
import { overviewHidden } from "@/server/overview-prefs";
import { pageContext } from "@/server/page";
import { getForecastPlan } from "@/server/forecast";
import { getContractComparison, getPaymentAnalysis } from "@/server/queries/contracts";
import { getOverview } from "@/server/queries/overview";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string | string[] }>;
}) {
  const ctx = await pageContext("/");
  const { p } = await searchParams;
  const period = typeof p === "string" ? p : undefined;
  // Blocs masqués par l'utilisateur (Réglages › Vue d'ensemble) : ni calculés ni affichés.
  const hidden = overviewHidden(ctx);
  const shown = (b: OverviewBlock) => !hidden.includes(b);
  const [overview, alerts, comparison, advice, payment, plan, lastPushAt] = await Promise.all([
    // Calculs partagés entre requêtes simultanées (clics rapides Mois / Année).
    shareInFlight(`overview:${ctx.householdId}:${period ?? ""}`, () => getOverview(ctx, period)),
    getAlerts(ctx),
    shown("contract")
      ? shareInFlight(`comparison:${ctx.householdId}`, () => getContractComparison(ctx))
      : null,
    shown("advice") ? getAdvice(ctx) : [],
    shown("payment") ? getPaymentAnalysis(ctx) : null,
    shown("advice") ? getForecastPlan(ctx) : null,
    getLastPushAt(ctx),
  ]);
  const label = (b: OverviewBlock) => OVERVIEW_BLOCKS.find((x) => x.id === b)?.label ?? b;
  const block = (b: OverviewBlock, render: (hide: React.ReactNode) => React.ReactNode) =>
    shown(b) ? (
      <Hideable block={b} label={label(b)}>
        {render(<HideButton label={label(b)} />)}
      </Hideable>
    ) : null;
  const modules = visibleModules(ctx.profile);

  const measured = lastPushAt && measuredUntil(lastPushAt, ctx.timezone);

  return (
    <PeriodTransition>
      <PageHeader
        title="Vue d'ensemble"
        subtitle={
          measured
            ? `Mesures jusqu'au ${measured}`
            : "Budget énergie, origine de la consommation et postes"
        }
      >
        {overview.status === "ok" && <PeriodSwitcher overview={overview} />}
      </PageHeader>
      <AlertsCard alerts={alerts} />
      {overview.status === "no-data" ? (
        <EmptyState title="Aucune donnée pour l'instant.">
          Le tableau de bord se remplit dès le premier envoi de Home Assistant, ou avec
          l&apos;import de votre historique.
        </EmptyState>
      ) : (
        <PeriodContent>
          <MarkersStrip
            markers={overview.markers}
            period={overview.period}
            today={localParts(new Date(), ctx.timezone).date}
          />
          <BatteryGapNotices gaps={overview.batteryGaps} context="overview" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-stretch gap-4">
            <BudgetCard overview={overview} />
            <OriginCard overview={overview} solar={modules.solar} battery={modules.battery} />
          </div>
          {comparison &&
            block("contract", (hide) => (
              <CheaperContractNotice comparison={comparison} hide={hide} />
            ))}
          {block("advice", (hide) => (
            <AdviceCard
              advice={advice}
              forecast={
                plan?.status === "ok"
                  ? { windows: windowTips(plan, ctx.timezone), appliances: plan.appliances }
                  : null
              }
              actions={hide}
            />
          ))}
          <MonthlyCostCard
            months={overview.months}
            days={overview.days}
            priced={overview.budget.totalCents !== null}
            period={overview.period}
            markers={overview.markers}
          />
          <section aria-labelledby="retenir" className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 id="retenir" className="text-xl font-bold">
                {overview.period.kind === "year"
                  ? `Ce qu'il faut retenir de ${overview.period.label}`
                  : "Ce qu'il faut retenir ce mois-ci"}
              </h2>
              <p className="text-sm text-muted">
                Un enseignement par sujet ; le détail en un clic.
              </p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-4">
              {block("peak", (hide) => (
                <PeakInsight overview={overview} actions={hide} />
              ))}
              <CategoriesInsight overview={overview} />
              {block("baseload", (hide) => (
                <BaseloadInsight overview={overview} actions={hide} />
              ))}
              <SolarInsight overview={overview} />
            </div>
          </section>
          <details className="group">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
              Détail mois par mois {overview.period.key.slice(0, 4)}
              <span className="transition-transform group-open:rotate-90">
                <Icon name="chevron" size={14} />
              </span>
            </summary>
            <div className="pt-2">
              <MonthlyTable
                months={overview.months}
                year={overview.period.key.slice(0, 4)}
                currentMonth={localParts(new Date(), ctx.timezone).date.slice(0, 7)}
                solar={modules.solar}
                priced={overview.budget.totalCents !== null}
              />
            </div>
          </details>
          {payment &&
            block("payment", (hide) => (
              <PaymentBanner
                payment={{ amountCents: payment.payment.amountCents, analysis: payment.analysis }}
                hide={hide}
              />
            ))}
          <Link
            href={settingsHref("vue-ensemble")}
            className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold"
          >
            <Icon name="layout" size={16} />
            Personnaliser cette vue
          </Link>
        </PeriodContent>
      )}
    </PeriodTransition>
  );
}

/** « mardi 27 octobre, 22 h » : l'heure du dernier envoi, dans le fuseau du foyer. */
function measuredUntil(at: Date, timezone: string): string {
  const day = at.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  });
  const hour = at.toLocaleTimeString("fr-FR", {
    hour: "numeric",
    hour12: false,
    timeZone: timezone,
  });
  return `${day}, ${Number.parseInt(hour, 10)} h`;
}
