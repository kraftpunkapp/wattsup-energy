import { CoverageBadge } from "@/components/coverage-badge";
import { MarketSourceNote } from "@/components/market-source-note";
import { tempoSeasonOf } from "@/domain/tempo-calendar";
import { addDays, eachDay, localParts } from "@/lib/time";
import { listContracts } from "@/server/contracts";
import { shareInFlight } from "@/server/inflight";
import { pageContext } from "@/server/page";
import { getMarketOffers } from "@/server/market/compare";
import { getContractComparison, getPaymentAnalysis } from "@/server/queries/contracts";
import { sobrietyCalendarView } from "@/server/calendars";
import { tempoCalendarView } from "@/server/tempo/sync";
import { ComparisonEmpty, comparedRows, comparisonExtras } from "./comparison";
import { ComparisonCard, type MarketState } from "./comparison-card";
import { ContractsManager } from "./contracts-manager";
import { ContractsDiagnostic } from "./diagnostic";
import { ContractHistory } from "./history";
import { toContractItems } from "./items";
import { SobrietyCalendar, type SobrietyDay } from "./sobriety-calendar";
import { TempoCalendar, type CalendarDay } from "./tempo-calendar";

export const metadata = { title: "Contrats · WattsUp Energy" };

export default async function ContractsPage() {
  const ctx = await pageContext("/contrats");
  const [contracts, comparison, market, payment] = await Promise.all([
    listContracts(ctx),
    shareInFlight(`comparison:${ctx.householdId}`, () => getContractComparison(ctx)),
    shareInFlight(`market:${ctx.householdId}`, () => getMarketOffers(ctx)),
    getPaymentAnalysis(ctx),
  ]);

  // Calendrier Tempo de la saison en cours, jusqu'au lendemain (couleur publiée vers 11 h).
  const today = localParts(new Date(), ctx.timezone).date;
  const hasTempo = contracts.some((c) => c.kind === "tempo");
  // Zen Flex (T57) : un contrat dont une grille a des règles propres aux jours de sobriété.
  const hasSobriety = contracts.some((c) =>
    c.periods.some(
      (p) => p.contract.kind === "custom" && p.contract.rules.some((r) => r.onlySobrietyDays),
    ),
  );
  const season = tempoSeasonOf(today);
  const seasonFrom = `${season.slice(0, 4)}-09-01`;
  const seasonTo = addDays(today, 1);
  const seasonDays = eachDay(seasonFrom, addDays(seasonTo, 1));
  let calendar: CalendarDay[] = [];
  if (hasTempo) {
    const view = await tempoCalendarView(ctx.householdId, seasonFrom, seasonTo);
    calendar = seasonDays.map((date) => ({
      date,
      color: view.get(date)?.color ?? null,
      source: view.get(date)?.source ?? null,
    }));
  }
  let sobrietyDays: SobrietyDay[] = [];
  if (hasSobriety) {
    // Jours de sobriété possibles d'octobre à avril : la carte commence le 1er octobre.
    const from = `${season.slice(0, 4)}-10-01`;
    const view = await sobrietyCalendarView(ctx.householdId, from, seasonTo);
    sobrietyDays = (from > seasonTo ? [] : eachDay(from, addDays(seasonTo, 1))).map((date) => ({
      date,
      sobriety: view.get(date)?.sobriety ?? false,
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

  const items = toContractItems(contracts, today);
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const subtitle =
    comparison.status === "ok"
      ? `Votre diagnostic, calculé sur votre consommation réelle du ${fmt(comparison.from)} au ${fmt(comparison.to)} (${Math.round(comparison.kwh).toLocaleString("fr-FR")} kWh achetés), aux prix d'aujourd'hui.`
      : "Coût simulé de chaque offre sur votre consommation réelle";

  return (
    <ContractsManager
      today={today}
      contracts={items}
      paymentAnalysis={payment?.analysis ?? null}
      subtitle={subtitle}
      meta={
        comparison.status === "ok" ? (
          <CoverageBadge ratio={comparison.coverage} granularity={comparison.granularity} />
        ) : undefined
      }
      diagnostic={
        comparison.status === "ok" && rows.length > 0 ? (
          <ContractsDiagnostic
            comparison={comparison}
            rows={rows}
            payment={
              payment
                ? { amountCents: payment.payment.amountCents, analysis: payment.analysis }
                : null
            }
          />
        ) : null
      }
      beside={
        comparison.status !== "ok" ? (
          <ComparisonEmpty comparison={comparison} />
        ) : rows.length > 0 || marketState.status === "no-power" ? (
          <ComparisonCard
            rows={rows}
            {...comparisonExtras(comparison)}
            market={marketState}
            note={
              market.status === "ok" ? <MarketSourceNote catalogDate={market.catalogDate} /> : null
            }
          />
        ) : null
      }
      history={<ContractHistory contracts={items} />}
      extra={
        <>
          {hasTempo && <TempoCalendar season={season} days={calendar} />}
          {sobrietyDays.length > 0 && <SobrietyCalendar season={season} days={sobrietyDays} />}
        </>
      }
    />
  );
}
