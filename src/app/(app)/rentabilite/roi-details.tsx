import Link from "next/link";
import { BatteryGapNotices } from "@/components/battery-gap-notice";
import { button, Callout, Notice } from "@/components/ui";
import { monthLabel, monthName } from "@/domain/overview";
import { formatEurFromCents, formatNumber, formatPercent } from "@/lib/format";
import type { EquipmentRoi, RoiView } from "@/server/queries/roi";
import { periodLabel } from "./roi-summary";

// Amortissement d'un équipement (T30), affiché dans sa carte : ce qu'il a déjà rapporté, où
// il en est, le prochain palier, puis l'économie récente et la date d'amortissement (ou la
// fourchette tant qu'on mesure depuis moins d'un an).

const eur = (cents: number) => formatEurFromCents(cents, 0);
const fmtMonth = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const MILESTONE_NAME = {
  0.25: "le premier quart",
  0.5: "la moitié",
  0.75: "les trois quarts",
  1: "l'amortissement complet",
} as const;

export function RoiDetails({ roi, view }: { roi: EquipmentRoi; view: RoiView }) {
  const { savings, payback, recent, milestone, range } = roi;
  const solar = roi.equipment.kind === "solar";
  const costCents = roi.equipment.costEur * 100;
  const lines = solar
    ? [
        { label: "Électricité évitée (autoconsommation)", cents: savings.parts.avoided },
        ...(view.settings.exportEnabled
          ? [{ label: "dont revente du surplus", cents: savings.parts.export }]
          : []),
      ]
    : [
        { label: "Électricité évitée (décharge)", cents: savings.parts.avoided },
        ...(view.settings.batteryGridCharging
          ? [{ label: "Charge depuis le réseau", cents: savings.parts.gridCharge }]
          : []),
        ...(view.settings.exportEnabled
          ? [{ label: "Revente perdue (énergie stockée)", cents: savings.parts.lostExport }]
          : []),
      ];
  const paybackYear = payback.paybackDate?.slice(0, 4) ?? null;
  // Rien à détailler (ex. batterie sans économie ventilée) : la section est masquée.
  const hasBreakdown = lines.some((l) => l.cents !== 0);
  const fill = solar ? "bg-solar text-ink" : "bg-battery text-on-fill";

  return (
    <div className="flex flex-col gap-4">
      <BatteryGapNotices gaps={roi.gaps} context="roi" />
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="wu-amount text-3xl leading-none">{eur(payback.cumulativeCents)}</span>
        <span className="text-sm text-ink-soft">
          économisés
          {costCents > payback.cumulativeCents &&
            ` · reste ${eur(costCents - payback.cumulativeCents)}`}
        </span>
      </p>
      <div
        role="img"
        aria-label={`${formatPercent(payback.ratio)} amortis`}
        className="relative h-[22px] rounded-[6px] bg-track"
      >
        <div
          className={`wu-grow-x absolute inset-y-0 left-0 flex min-w-11 items-center justify-end rounded-[6px] pr-2 text-[13px] font-bold ${fill}`}
          style={{ width: `${payback.ratio * 100}%` }}
        >
          {formatPercent(payback.ratio)}
        </div>
        {milestone && milestone.ratio < 1 && (
          <span
            aria-hidden
            className="absolute -top-[3px] -bottom-[3px] w-0.5 bg-dash"
            style={{ left: `${milestone.ratio * 100}%` }}
          />
        )}
      </div>
      {payback.status === "amortized" ? (
        <p className="text-sm text-ink-soft">
          <strong className="text-ink">Amorti.</strong> L&apos;équipement a remboursé son coût
          (installé le {fmtDay(roi.equipment.installedOn)}).
        </p>
      ) : payback.status === "no-savings" ? (
        <Notice tone="info" title="Aucune économie mesurée :">
          rien à rembourser pour l&apos;instant sur les données reçues depuis l&apos;installation.
        </Notice>
      ) : (
        milestone && (
          <p className="text-sm text-ink-soft">
            Prochain jalon : <strong className="text-ink">{MILESTONE_NAME[milestone.ratio]}</strong>
            {milestone.date && <>, vers {fmtMonth(milestone.date)}</>}
          </p>
        )
      )}

      {payback.status !== "no-savings" && (recent || paybackYear || range) && (
        <div className="grid grid-cols-2 gap-3 text-sm text-ink-soft max-sm:grid-cols-1">
          {recent && (
            <div className="flex flex-col gap-0.5 rounded-control bg-bg px-3.5 py-3">
              <span className="wu-label">
                {recent.months >= 12
                  ? "Économies sur 12 mois"
                  : `Économies · ${periodLabel(recent)}`}
              </span>
              <strong className="wu-amount text-[17px] text-ink">≈ {eur(recent.cents)}</strong>
              <span className="wu-mono text-xs text-muted">
                {monthLabel(recent.from)} → {monthLabel(recent.to)}
              </span>
            </div>
          )}
          {payback.status === "in-progress" && (range || paybackYear) && (
            <div className="flex flex-col gap-0.5 rounded-control bg-bg px-3.5 py-3">
              <span className="wu-label">Amortissement</span>
              <strong className="wu-amount text-[17px] text-ink">
                {range ? `${range.early.slice(0, 4)} – ${range.late.slice(0, 4)}` : paybackYear}
              </strong>
              <span className="text-xs text-muted">
                {range ? "selon la saison" : "estimation, à prix de l'électricité constants"}
              </span>
            </div>
          )}
        </div>
      )}

      {range && payback.status === "in-progress" && (
        <Callout>
          <strong>
            Amorti{solar ? "" : "e"} entre {range.early.slice(0, 4)} et {range.late.slice(0, 4)}
            {range.early.slice(0, 4) === range.late.slice(0, 4)
              ? ` (${monthName(range.early)} à ${monthName(range.late)})`
              : ""}
            , selon la saison.
          </strong>{" "}
          {solar ? "L'installation" : "La batterie"} n&apos;est mesurée que depuis{" "}
          {roi.dataFrom ? fmtMonth(roi.dataFrom) : "peu"} : ses{" "}
          {formatNumber(payback.monthlyCents / 100)} €/mois sont ceux de {periodLabel(recent)}. La
          fourchette se resserrera avec une année complète.
        </Callout>
      )}

      {hasBreakdown && (
        <details className="text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
            D&apos;où viennent ces économies
          </summary>
          <ul className="flex flex-col gap-1.5 pb-1 text-[13px]">
            {lines.map((l) => (
              <li key={l.label} className="flex justify-between gap-2">
                <span className="text-ink-soft">{l.label}</span>
                <span className="whitespace-nowrap tabular-nums">{eur(l.cents)}</span>
              </li>
            ))}
          </ul>
          {!solar && view.settings.batteryGridCharging && (
            <p className="pt-1 text-xs text-muted">
              Charge depuis le réseau incluse dans le calcul.
            </p>
          )}
        </details>
      )}

      {solar &&
        view.solarYield &&
        (view.solarYield.alert ? (
          <Notice title={`Production en baisse en ${monthLabel(view.solarYield.month)} :`}>
            {formatPercent(Math.abs(view.solarYield.deviation))} sous le rendement attendu pour
            l&apos;ensoleillement reçu ({formatNumber(view.solarYield.yield, 2)} kWh par kWh/m²,
            contre {formatNumber(view.solarYield.reference, 2)} d&apos;habitude). Vérifiez la
            propreté des panneaux et l&apos;état de l&apos;onduleur.
          </Notice>
        ) : (
          <Callout icon="sun" tone="neutral">
            Rendement de {monthLabel(view.solarYield.month)} :{" "}
            <span className="font-semibold text-ink">
              {formatNumber(view.solarYield.yield, 2)} kWh par kWh/m²
            </span>{" "}
            reçu ({view.solarYield.deviation >= 0 ? "+" : "−"}
            {formatPercent(Math.abs(view.solarYield.deviation))} par rapport à d&apos;habitude).
          </Callout>
        ))}

      {view.noContract && (
        <Notice
          title="Économies non chiffrées :"
          action={
            <Link href="/contrats" className={button.primary}>
              Ajouter mon contrat
            </Link>
          }
        >
          sans contrat d&apos;électricité en cours, le prix du kWh évité est inconnu.
        </Notice>
      )}
    </div>
  );
}
