import { MarketSourceNote } from "@/components/market-source-note";
import { PageHeader } from "@/components/page-header";
import { isOldGrid } from "@/domain/market/offer";
import { tempoSeasonOf } from "@/domain/tempo-calendar";
import { addDays, eachDay, localParts } from "@/lib/time";
import { listContracts } from "@/server/contracts";
import { shareInFlight } from "@/server/inflight";
import { pageContext } from "@/server/page";
import { getMarketOffers } from "@/server/market/compare";
import { getContractComparison } from "@/server/queries/contracts";
import { tempoCalendarView } from "@/server/tempo/sync";
import { ComparisonBanner, ComparisonEmpty, ComparisonList } from "./comparison";
import { ContractsManager } from "./contracts-manager";
import { toContractItems } from "./items";
import { KIND_LABELS } from "./labels";
import { MarketOffersList, MarketOffersNoPower, type MarketOfferView } from "./market-offers";
import { TempoCalendar, type CalendarDay } from "./tempo-calendar";

export const metadata = { title: "Contrats · WattsUp Energy" };

const fmtGridDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

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

  // Offres du marché : affichées dès qu'il y a un catalogue et une consommation à rejouer.
  const mine = new Set(contracts.map((c) => c.name));
  const marketRows: MarketOfferView[] =
    market.status === "ok"
      ? market.rows.map((r) => ({
          name: r.name,
          provider: r.provider,
          offer: r.offer,
          kind: KIND_LABELS[r.kind],
          regulated: r.regulated,
          gridDate: fmtGridDate(r.gridDate),
          oldGrid: isOldGrid(r.gridDate, today),
          annualCents: r.annualCents,
          deltaAnnualCents: r.deltaAnnualCents,
          assumedOffPeak: r.assumedOffPeak,
          approximate: r.approximate,
          assumedTempoDays: r.assumedTempoDays,
          priceUrl: r.priceUrl,
          added: mine.has(r.name.slice(0, 60)),
        }))
      : [];
  const bestMarket = market.status === "ok" ? market.rows[0] : undefined;
  const bestOwn = comparison.status === "ok" ? comparison.rows[0] : undefined;
  const marketBeatsOwn =
    bestMarket && (!bestOwn || bestMarket.annualCents < bestOwn.annualCents) ? bestMarket : null;

  return (
    <>
      <PageHeader
        title="Contrats"
        subtitle="Coût simulé de chaque offre sur votre consommation réelle"
      />
      {comparison.status === "ok" && contracts.length > 0 && (
        <ComparisonBanner
          comparison={comparison}
          market={
            marketBeatsOwn
              ? {
                  name: marketBeatsOwn.name,
                  annualCents: marketBeatsOwn.annualCents,
                  deltaAnnualCents: marketBeatsOwn.deltaAnnualCents,
                }
              : null
          }
        />
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] items-start gap-4">
        <div className="flex flex-col gap-4">
          {comparison.status !== "ok" ? (
            <ComparisonEmpty comparison={comparison} />
          ) : (
            contracts.length > 0 && <ComparisonList comparison={comparison} />
          )}
          {comparison.status === "ok" && market.status === "no-power" && <MarketOffersNoPower />}
          {market.status === "ok" && (
            <MarketOffersList
              kva={market.kva}
              offers={marketRows}
              pending={market.pending}
              unavailable={market.unavailable}
              hasCurrent={market.currentAnnualCents !== null}
              note={<MarketSourceNote catalogDate={market.catalogDate} />}
            />
          )}
          {hasTempo && <TempoCalendar season={season} days={calendar} />}
        </div>
        <ContractsManager today={today} contracts={toContractItems(contracts, today)} />
      </div>
    </>
  );
}
