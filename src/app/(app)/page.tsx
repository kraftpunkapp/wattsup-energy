import {
  BudgetCard,
  CategoriesOverviewCard,
  CheaperContractNotice,
  KpiTiles,
  PaymentNotice,
  OriginCard,
  PeakCard,
  PeriodSwitcher,
  SolarCard,
} from "@/components/cards/overview-cards";
import { BatteryGapNotices } from "@/components/battery-gap-notice";
import { AdviceCard, windowTips } from "@/components/cards/advice-card";
import { AlertsCard } from "@/components/cards/alerts-card";
import { BaseloadCard } from "@/components/cards/baseload-card";
import { MarkersStrip } from "@/components/cards/markers-strip";
import { PeriodContent, PeriodTransition } from "@/components/period-transition";
import { MonthlyCostCard } from "@/components/cards/monthly-cost-card";
import { MonthlyTable } from "@/components/cards/monthly-table";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { HideButton, Hideable } from "@/components/overview/hideable";
import { OVERVIEW_BLOCKS, type OverviewBlock } from "@/domain/overview-blocks";
import { visibleModules } from "@/domain/profile";
import { localParts } from "@/lib/time";
import { getAdvice } from "@/server/advice";
import { getAlerts } from "@/server/alerts";
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
  const [overview, alerts, comparison, advice, payment, plan] = await Promise.all([
    // Calculs partagés entre requêtes simultanées (clics rapides Mois / Année).
    shareInFlight(`overview:${ctx.householdId}:${period ?? ""}`, () => getOverview(ctx, period)),
    getAlerts(ctx),
    shown("contract")
      ? shareInFlight(`comparison:${ctx.householdId}`, () => getContractComparison(ctx))
      : null,
    shown("advice") ? getAdvice(ctx) : [],
    shown("payment") ? getPaymentAnalysis(ctx) : null,
    shown("advice") ? getForecastPlan(ctx) : null,
  ]);
  const label = (b: OverviewBlock) => OVERVIEW_BLOCKS.find((x) => x.id === b)?.label ?? b;
  const block = (b: OverviewBlock, render: (hide: React.ReactNode) => React.ReactNode) =>
    shown(b) ? (
      <Hideable block={b} label={label(b)}>
        {render(<HideButton label={label(b)} />)}
      </Hideable>
    ) : null;
  const modules = visibleModules(ctx.profile);

  return (
    <>
      <PageHeader
        title="Vue d'ensemble"
        subtitle="Budget énergie, origine de la consommation et postes"
      />
      <AlertsCard alerts={alerts} />
      {overview.status === "no-data" ? (
        <EmptyState title="Aucune donnée pour l'instant.">
          Le tableau de bord se remplit dès le premier envoi de Home Assistant, ou avec
          l&apos;import de votre historique.
        </EmptyState>
      ) : (
        <PeriodTransition>
          <PeriodSwitcher overview={overview} />
          <PeriodContent>
            <MarkersStrip
              markers={overview.markers}
              period={overview.period}
              today={localParts(new Date(), ctx.timezone).date}
            />
            <BatteryGapNotices gaps={overview.batteryGaps} context="overview" />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
              <BudgetCard overview={overview} />
              <KpiTiles overview={overview} solar={modules.solar} battery={modules.battery} />
            </div>
            {comparison &&
              block("contract", (hide) => (
                <CheaperContractNotice comparison={comparison} hide={hide} />
              ))}
            {payment &&
              block("payment", (hide) => (
                <PaymentNotice
                  payment={{ amountCents: payment.payment.amountCents, analysis: payment.analysis }}
                  hide={hide}
                />
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
            {block("peak", (hide) => (
              <PeakCard overview={overview} actions={hide} />
            ))}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-start gap-4">
              <OriginCard overview={overview} solar={modules.solar} battery={modules.battery} />
              <CategoriesOverviewCard overview={overview} />
            </div>
            {block("baseload", (hide) => (
              <BaseloadCard overview={overview} actions={hide} />
            ))}
            <SolarCard overview={overview} />
            <MonthlyTable
              months={overview.months}
              year={overview.period.key.slice(0, 4)}
              currentMonth={localParts(new Date(), ctx.timezone).date.slice(0, 7)}
              solar={modules.solar}
              priced={overview.budget.totalCents !== null}
            />
          </PeriodContent>
        </PeriodTransition>
      )}
    </>
  );
}
