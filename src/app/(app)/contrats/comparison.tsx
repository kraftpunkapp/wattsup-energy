import { CoverageBadge } from "@/components/coverage-badge";
import { EmptyState } from "@/components/empty-state";
import { Badge, Notice } from "@/components/ui";
import type { ContractComparison } from "@/server/queries/contracts";
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

export function ComparisonBanner({
  comparison,
  market,
}: {
  comparison: Ok;
  /** Offre du marché moins chère que toutes les offres du foyer (SPEC §7.12) ; null sinon. */
  market: { name: string; annualCents: number; deltaAnnualCents: number | null } | null;
}) {
  const best = comparison.rows[0];
  const current = comparison.rows.find((r) => r.isCurrent);
  if (!best) return null;
  const partial = comparison.periodDays < 365;
  const saving = current && best.id !== current.id ? current.annualCents - best.annualCents : 0;

  return (
    <section className="flex flex-col gap-1.5 rounded-card border border-panel-edge bg-panel p-5 text-panel-ink">
      <span className="text-[13px] text-panel-muted">
        Contrat le plus économique sur{" "}
        {partial ? `${comparison.periodDays} jours de données` : "12 mois réels"}
      </span>
      <p className="text-[22px] leading-snug font-semibold tracking-tight text-pretty">
        {!current ? (
          <>
            {best.name} :{" "}
            <span className="text-panel-positive tabular-nums">{eur(best.annualCents)}/an</span>
          </>
        ) : saving > 0 ? (
          <>
            {best.name} :{" "}
            <span className="text-panel-positive tabular-nums">−{eur(saving)}/an</span> par rapport
            à votre contrat actuel
          </>
        ) : (
          <>Votre contrat actuel est déjà le moins cher des offres comparées</>
        )}
      </p>
      {market && (
        <p className="text-sm text-pretty">
          Meilleure offre du marché : {market.name},{" "}
          {market.deltaAnnualCents !== null && market.deltaAnnualCents < 0 ? (
            <>
              <span className="font-semibold text-panel-positive tabular-nums">
                −{eur(-market.deltaAnnualCents)}/an
              </span>{" "}
              par rapport à votre contrat actuel
            </>
          ) : (
            <span className="font-semibold tabular-nums">{eur(market.annualCents)}/an</span>
          )}
        </p>
      )}
      <span className="text-xs text-panel-muted tabular-nums">
        {fmtDate(comparison.from)} – {fmtDate(comparison.to)} ·{" "}
        {Math.round(comparison.kwh).toLocaleString("fr-FR")} kWh soutirés
        {comparison.redDays > 0 ? ` · ${comparison.redDays} jours rouges` : ""}
        {partial ? " · coûts annualisés" : ""}
      </span>
    </section>
  );
}

export function ComparisonList({ comparison }: { comparison: Ok }) {
  const max = Math.max(...comparison.rows.map((r) => r.annualCents), 1);
  const best = comparison.rows[0];
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Coût annuel simulé</h2>
        <CoverageBadge ratio={comparison.coverage} granularity={comparison.granularity} />
      </div>
      {comparison.real && (
        <div className="flex items-center justify-between gap-2 rounded-[10px] bg-bg px-3 py-2.5">
          <span className="flex flex-col">
            <span className="text-[13px] font-medium">Réellement payé</span>
            <span className="text-[11px] text-subtle">
              contrats et prix en vigueur chaque jour
              {comparison.real.unknownContractDays > 0 &&
                ` · ${comparison.real.unknownContractDays} j sans contrat, estimés au tarif actuel`}
            </span>
          </span>
          <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">
            {eur(comparison.real.annualCents)}/an
          </span>
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {comparison.rows.map((r) => {
          const delta = r.deltaAnnualCents;
          return (
            <li key={r.id} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{r.name}</span>
                  <Badge>{KIND_LABELS[r.contract.kind]}</Badge>
                  {r.isCurrent && <Badge tone="active">En cours</Badge>}
                </span>
                <span className="flex flex-none flex-col items-end">
                  <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">
                    {eur(r.annualCents)}/an
                  </span>
                  <span
                    className={`text-[11px] font-medium tabular-nums ${
                      delta === null || delta === 0
                        ? "text-subtle"
                        : delta < 0
                          ? "text-positive"
                          : "text-negative"
                    }`}
                  >
                    {r.isCurrent
                      ? "référence"
                      : delta === null
                        ? ""
                        : `${delta < 0 ? "−" : "+"}${eur(Math.abs(delta))}`}
                  </span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-track">
                <div
                  className={`h-1.5 rounded-full ${r.id === best?.id ? "bg-battery" : r.isCurrent ? "bg-grid" : "bg-dash"}`}
                  style={{ width: `${(r.annualCents / max) * 100}%` }}
                />
              </div>
              {(r.approximate || r.assumedTempoDays > 0) && (
                <span className="text-[11px] text-pellet">
                  {r.approximate &&
                    "Simulation approximative : passez en envoi horaire pour plus de précision. "}
                  {r.assumedTempoDays > 0 &&
                    `${r.assumedTempoDays} jour${r.assumedTempoDays > 1 ? "s" : ""} de couleur inconnue, supposé${r.assumedTempoDays > 1 ? "s" : ""} bleu${r.assumedTempoDays > 1 ? "s" : ""}.`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
