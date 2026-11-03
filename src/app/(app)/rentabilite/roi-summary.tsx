import { monthName } from "@/domain/overview";
import { formatEurFromCents, formatNumber, formatPercent } from "@/lib/format";
import type { RoiView } from "@/server/queries/roi";

const eur = (cents: number) => formatEurFromCents(cents, 0);

/** « 12 derniers mois », « juin à octobre » : la période sur laquelle l'économie mensuelle est calculée. */
export function periodLabel(recent: NonNullable<RoiView["items"]["solar"]>["recent"]) {
  if (!recent) return "";
  return recent.months >= 12
    ? "12 derniers mois"
    : recent.months === 1
      ? monthName(recent.from)
      : `${monthName(recent.from)} à ${monthName(recent.to)}`;
}

/** Économies cumulées de tous les équipements, face au total investi. */
export function RoiSummary({ view }: { view: RoiView }) {
  const items = Object.values(view.items);
  if (items.length < 2) return null;
  const saved = items.reduce((a, i) => a + i.payback.cumulativeCents, 0);
  const invested = items.reduce((a, i) => a + i.equipment.costEur, 0) * 100;
  if (invested <= 0) return null;
  const ratio = Math.min(1, Math.max(0, saved / invested));
  const periods = new Set(items.map((i) => periodLabel(i.recent)));
  return (
    <section
      aria-label="Économies cumulées"
      className="flex flex-wrap gap-x-10 gap-y-5 rounded-card border border-border bg-surface p-6 sm:px-7"
    >
      <div className="flex min-w-0 flex-[2_1_420px] flex-col gap-3">
        <p className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <span className="text-[44px] leading-none font-bold tracking-[-0.02em] tabular-nums">
            {eur(saved)}
          </span>
          <span className="text-base text-ink-soft">
            d&apos;économies cumulées, sur {eur(invested)} investis
          </span>
        </p>
        <div
          role="img"
          aria-label={`${formatPercent(ratio)} amortis`}
          className="relative h-[22px] rounded-[6px] bg-track"
        >
          <div
            className="wu-grow-x absolute inset-y-0 left-0 flex min-w-11 items-center justify-end rounded-[6px] bg-positive pr-2 text-[13px] font-bold text-white"
            style={{ width: `${ratio * 100}%` }}
          >
            {formatPercent(ratio)}
          </div>
        </div>
        {invested > saved && (
          <p className="text-[15px] text-ink-soft">
            Reste <strong className="text-ink">{eur(invested - saved)}</strong> à récupérer
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 text-[15px]">
        <h2 className="text-[13px] font-bold text-ink-soft">Économies actuelles</h2>
        {items.map((i) => (
          <p key={i.equipment.kind} className="flex justify-between gap-3">
            <span className="text-ink-soft">
              {i.equipment.kind === "solar" ? "Panneaux" : "Batterie"} · {periodLabel(i.recent)}
            </span>
            <strong className="whitespace-nowrap tabular-nums">
              {formatNumber(i.payback.monthlyCents / 100)} € / mois
            </strong>
          </p>
        ))}
        {periods.size > 1 && (
          <p className="text-[13px] text-muted">
            Périodes différentes : à ne pas additionner telles quelles.
          </p>
        )}
      </div>
    </section>
  );
}
