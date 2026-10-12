import { CoverageBadge } from "@/components/coverage-badge";
import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/ui";
import { isOldGrid } from "@/domain/market/offer";
import type { ContractWithPeriods } from "@/server/contracts";
import type { MarketOffers } from "@/server/market/compare";
import type { ContractComparison } from "@/server/queries/contracts";
import type { ComparedRow, RowOrigin } from "./comparison-card";
import { KIND_LABELS } from "./labels";

const eur = (cents: number) => `${Math.round(cents / 100).toLocaleString("fr-FR")} €`;
const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

type Ok = Extract<ContractComparison, { status: "ok" }>;

export function ComparisonEmpty({ comparison }: { comparison: Exclude<ContractComparison, Ok> }) {
  if (comparison.status === "no-data") {
    return (
      <EmptyState title="Comparaison des contrats :">
        aucune consommation reçue sur les 12 derniers mois.
      </EmptyState>
    );
  }
  return (
    <Notice tone="info" title="Comparaison des contrats :">
      {comparison.days} jour{comparison.days > 1 ? "s" : ""} de données pour l&apos;instant ; elle
      s&apos;affiche à partir de 7 jours.
    </Notice>
  );
}

/** Écart sous lequel deux offres coûtent la même chose (un euro par an). */
const SAME_CENTS = 100;

/**
 * Bandeau du haut : l'offre la moins chère du classement (offres simulées, à venir et du
 * marché ; les anciens contrats n'en sont pas), comparée au contrat actuel.
 */
export function ComparisonBanner({
  comparison,
  rows,
}: {
  comparison: Ok;
  rows: readonly ComparedRow[];
}) {
  const current = rows.find((r) => r.origin === "current");
  const best = rows.find((r) => r.origin !== "current" && r.origin !== "past");
  if (!best && !current) return null;
  const partial = comparison.periodDays < 365;
  const saving = current && best?.deltaAnnualCents != null ? -best.deltaAnnualCents : 0;
  const title = (r: ComparedRow) => (r.provider ? `${r.provider} - ${r.name}` : r.name);

  return (
    <section className="flex flex-col gap-1.5 rounded-card border border-panel-edge bg-panel p-5 text-panel-ink">
      <span className="text-[13px] text-panel-muted">
        Offre la plus économique sur{" "}
        {partial ? `${comparison.periodDays} jours de données` : "12 mois réels"}
      </span>
      <p className="text-[22px] leading-snug font-semibold tracking-tight text-pretty">
        {!current && best ? (
          <>
            {title(best)} :{" "}
            <span className="text-panel-positive tabular-nums">{eur(best.annualCents)}/an</span>
          </>
        ) : best && saving >= SAME_CENTS ? (
          <>
            {title(best)} :{" "}
            <span className="text-panel-positive tabular-nums">−{eur(saving)}/an</span> par rapport
            à votre contrat actuel
          </>
        ) : best && saving > -SAME_CENTS ? (
          <>Votre contrat actuel est au même prix que la meilleure offre comparée</>
        ) : (
          <>Votre contrat actuel est déjà le moins cher des offres comparées</>
        )}
      </p>
      <span className="text-xs text-panel-muted tabular-nums">
        {fmtDate(comparison.from)} – {fmtDate(comparison.to)} ·{" "}
        {Math.round(comparison.kwh).toLocaleString("fr-FR")} kWh soutirés
        {comparison.redDays > 0 ? ` · ${comparison.redDays} jours rouges` : ""}
        {partial ? " · coûts annualisés" : ""}
      </span>
    </section>
  );
}

/** Coût réellement payé et pastille de couverture, pour la carte de comparaison. */
export function comparisonExtras(comparison: Ok) {
  return {
    paid: comparison.real
      ? {
          annualCents: comparison.real.annualCents,
          unknownContractDays: comparison.real.unknownContractDays,
          partial: comparison.periodDays < 365,
        }
      : null,
    coverage: <CoverageBadge ratio={comparison.coverage} granularity={comparison.granularity} />,
  };
}

/**
 * Classement unique : offres du foyer (origine déduite du contrat : en cours, simulée, à venir,
 * ancienne) et offres du marché qui ne sont pas déjà dans ses offres, de la moins chère à la
 * plus chère.
 */
export function comparedRows(
  comparison: Ok,
  contracts: readonly ContractWithPeriods[],
  market: MarketOffers,
  today: string,
): ComparedRow[] {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const own: ComparedRow[] = comparison.rows.map((r) => {
    const c = byId.get(r.id);
    const origin: RowOrigin = r.isCurrent
      ? "current"
      : c?.status !== "subscribed"
        ? "simulated"
        : (c.startDate ?? "") > today
          ? "upcoming"
          : "past";
    return {
      key: r.id,
      origin,
      name: r.name,
      provider: null,
      originDetail:
        origin === "past" && c?.endDate
          ? `jusqu'au ${fmtDate(c.endDate)}`
          : origin === "upcoming" && c?.startDate
            ? `à partir du ${fmtDate(c.startDate)}`
            : null,
      kind: KIND_LABELS[r.contract.kind],
      regulated: false,
      annualCents: r.annualCents,
      deltaAnnualCents: r.deltaAnnualCents,
      approximate: r.approximate,
      assumedTempoDays: r.assumedTempoDays,
      assumedOffPeak: false,
      market: null,
    };
  });
  const names = new Set(contracts.map((c) => c.name));
  const offers: ComparedRow[] =
    market.status === "ok"
      ? market.rows
          .filter((r) => !names.has(r.name.slice(0, 60)))
          .map((r) => ({
            key: `market:${r.name}`,
            origin: "market",
            name: r.offer,
            provider: r.provider,
            originDetail: null,
            kind: KIND_LABELS[r.kind],
            regulated: r.regulated,
            annualCents: r.annualCents,
            deltaAnnualCents: r.deltaAnnualCents,
            approximate: r.approximate,
            assumedTempoDays: r.assumedTempoDays,
            assumedOffPeak: r.assumedOffPeak,
            market: {
              name: r.name,
              gridDate: fmtDate(r.gridDate),
              oldGrid: isOldGrid(r.gridDate, today),
              priceUrl: r.priceUrl,
            },
          }))
      : [];
  return [...own, ...offers].sort((a, b) => a.annualCents - b.annualCents);
}
