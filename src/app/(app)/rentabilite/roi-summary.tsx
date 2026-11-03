import { Gauge } from "@/components/ui";
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
      <div className="flex min-w-0 flex-[2_1_420px] flex-col gap-4">
        <h2 className="wu-label">Économies cumulées</h2>
        <p className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <span className="wu-amount text-5xl leading-none">{eur(saved)}</span>
          <span className="text-ink-soft">
            sur {eur(invested)} investis · {formatPercent(ratio)}
          </span>
        </p>
        <Gauge
          height={12}
          label={`${formatPercent(ratio)} amortis : ${items
            .map(
              (i) =>
                `${i.equipment.kind === "solar" ? "solaire" : "batterie"} ${eur(i.payback.cumulativeCents)}`,
            )
            .join(", ")}`}
          parts={[
            ...items.map((i) => ({
              value: Math.max(0, i.payback.cumulativeCents),
              color: i.equipment.kind === "solar" ? "bg-solar" : "bg-battery",
            })),
            { value: Math.max(0, invested - saved), color: "bg-track" },
          ]}
        />
        <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-soft">
          {items.map((i) => (
            <span key={i.equipment.kind} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={`size-2.5 rounded-[3px] ${i.equipment.kind === "solar" ? "bg-solar" : "bg-battery"}`}
              />
              {i.equipment.kind === "solar" ? "Solaire" : "Batterie"}{" "}
              {eur(i.payback.cumulativeCents)}
            </span>
          ))}
          {invested > saved && (
            <span className="text-muted">
              Reste <strong className="text-ink">{eur(invested - saved)}</strong> à récupérer
            </span>
          )}
        </p>
      </div>
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5 text-sm">
        <h2 className="wu-label">Économies actuelles</h2>
        {items.map((i) => (
          <p
            key={i.equipment.kind}
            className="flex items-center justify-between gap-3 rounded-control bg-bg px-4 py-3"
          >
            <span className="flex flex-col">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`size-2.5 rounded-[3px] ${i.equipment.kind === "solar" ? "bg-solar" : "bg-battery"}`}
                />
                {i.equipment.kind === "solar" ? "Solaire" : "Batterie"}
              </span>
              <span className="wu-mono text-xs text-muted">{periodLabel(i.recent)}</span>
            </span>
            <strong className="text-lg whitespace-nowrap tabular-nums">
              {formatNumber(i.payback.monthlyCents / 100)} €/mois
            </strong>
          </p>
        ))}
        {periods.size > 1 && (
          <p className="text-[13px] text-muted">Périodes différentes : ne pas additionner.</p>
        )}
      </div>
    </section>
  );
}
