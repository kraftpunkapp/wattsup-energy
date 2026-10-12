import { MarketSourceNote } from "@/components/market-source-note";
import { PageHeader } from "@/components/page-header";
import { tempoSeasonOf } from "@/domain/tempo-calendar";
import { addDays, eachDay, localParts } from "@/lib/time";
import { listContracts } from "@/server/contracts";
import { shareInFlight } from "@/server/inflight";
import { pageContext } from "@/server/page";
import { getMarketOffers } from "@/server/market/compare";
import { getContractComparison } from "@/server/queries/contracts";
import { tempoCalendarView } from "@/server/tempo/sync";
import { ComparisonBanner, ComparisonEmpty, comparedRows, comparisonExtras } from "./comparison";
import { ComparisonCard, type MarketState } from "./comparison-card";
import { ContractsManager } from "./contracts-manager";
import { toContractItems } from "./items";
import { TempoCalendar, type CalendarDay } from "./tempo-calendar";

export const metadata = { title: "Contrats · WattsUp Energy" };

export default async function ContractsPage() {
  const ctx = await pageContext("/contrats");
  const [contracts, comparison, market] = await Promise.all([
    listContracts(ctx),
    shareInFlight(`comparison:${ctx.householdId}`, () => getContractComparison(ctx)),
    shareInFlight(`market:${ctx.householdId}`, () => getMarketOffers(ctx)),
  ]);

  // Calendrier Tempo de la saison en cours, jusqu'au lendemain (couleur publiée vers 11 h).
  const today = localParts(new Date(), ctx.timezone).date;
  const hasTempo = contracts.some((c) => c.kind === "tempo");
  const season = tempoSeasonOf(today);
  let calendar: CalendarDay[] = [];
  if (hasTempo) {
    const from = `${season.slice(0, 4)}-09-01`;
    const to = addDays(today, 1);
    const view = await tempoCalendarView(ctx.householdId, from, to);
    calendar = eachDay(from, addDays(to, 1)).map((date) => ({
      date,
      color: view.get(date)?.color ?? null,
      source: view.get(date)?.source ?? null,
    }));
  }

  const rows = comparison.status === "ok" ? comparedRows(comparison, contracts, market, today) : [];
  const marketState: MarketState =
    market.status === "ok"
      ? { status: "ok", kva: market.kva, pending: market.pending, unavailable: market.unavailable }
      : market.status === "no-power"
        ? { status: "no-power" }
        : { status: "none" };

  return (
    <>
      <PageHeader
        title="Contrats"
        subtitle="Coût simulé de chaque offre sur votre consommation réelle"
      />
      {comparison.status === "ok" && rows.length > 0 && (
        <ComparisonBanner comparison={comparison} rows={rows} />
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] items-start gap-4">
        <div className="flex flex-col gap-4">
          {comparison.status !== "ok" ? (
            <ComparisonEmpty comparison={comparison} />
          ) : (
            (rows.length > 0 || marketState.status === "no-power") && (
              <ComparisonCard
                rows={rows}
                {...comparisonExtras(comparison)}
                market={marketState}
                note={
                  market.status === "ok" ? (
                    <MarketSourceNote catalogDate={market.catalogDate} />
                  ) : null
                }
              />
            )
          )}
          {hasTempo && <TempoCalendar season={season} days={calendar} />}
        </div>
        <ContractsManager today={today} contracts={toContractItems(contracts, today)} />
      </div>
    </>
  );
}
