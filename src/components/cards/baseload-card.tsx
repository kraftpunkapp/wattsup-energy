import type { ReactNode } from "react";
import { StackedBars } from "@/components/charts/stacked-bars";
import { Card } from "@/components/ui";
import { yearlyKwh } from "@/domain/baseload";
import { monthLabel, shortMonth } from "@/domain/overview";
import { formatEurFromCents, formatKwh, formatNumber } from "@/lib/format";
import type { Overview } from "@/server/queries/overview";

// Talon de consommation (T41) : puissance appelée en permanence, mesurée la nuit. Grand
// chiffre en W, son coût sur un an, l'écart à la même période un an plus tôt, puis les
// 12 derniers mois en barres pour voir une dérive (appareil resté allumé, congélateur usé).

type Ok = Extract<Overview, { status: "ok" }>;

export function BaseloadCard({
  overview,
  actions,
  flat,
}: {
  overview: Ok;
  actions?: ReactNode;
  flat?: boolean;
}) {
  const b = overview.baseload;
  if (!b) return null;
  const { period } = overview;
  const delta = b.watts !== null && b.previousWatts !== null ? b.watts - b.previousWatts : null;
  const shown = b.months.filter((m) => m.watts !== null);
  return (
    <Card
      flat={flat}
      icon="plug"
      title="Talon de consommation"
      actions={actions}
      description="Ce que la maison consomme en permanence, même quand personne n'utilise rien : box, réfrigérateur, VMC, veilles. Mesuré chaque nuit entre minuit et 6 h."
    >
      {b.watts === null ? (
        <p className="text-[13px] text-muted text-pretty">
          Pas encore assez de nuits complètes sur la période ({period.label}, 7 au moins) pour
          mesurer le talon.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[32px] leading-none font-semibold tracking-tight tabular-nums">
              {formatNumber(b.watts)} W
            </span>
            <span className="text-[13px] text-muted">en permanence · {period.label}</span>
          </p>
          <p className="text-[13px] text-ink-soft tabular-nums">
            ≈ {formatKwh(yearlyKwh(b.watts))} par an
            {b.centsPerKwh !== null &&
              ` · ≈ ${formatEurFromCents(yearlyKwh(b.watts) * b.centsPerKwh, 0)} par an`}
          </p>
          {delta !== null && (
            <p
              className={`text-xs tabular-nums ${
                delta > 0 ? "text-negative" : delta < 0 ? "text-positive" : "text-subtle"
              }`}
            >
              {delta === 0
                ? "Stable sur un an"
                : `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))} W par rapport à la même période un an plus tôt`}
            </p>
          )}
        </div>
      )}
      {shown.length >= 2 && (
        <div className="flex flex-col gap-1.5 border-t border-track pt-3">
          <p className="text-[11px] text-muted">
            12 derniers mois · le plus haut :{" "}
            {formatNumber(Math.max(...shown.map((m) => m.watts ?? 0)))} W
          </p>
          <StackedBars
            height={72}
            ariaLabel="Talon de consommation des 12 derniers mois, en watts"
            bars={b.months.map((m) => ({
              key: m.month,
              // Initiale : 12 barres tiennent sur un téléphone ; le mois entier est dans l'info-bulle.
              label: shortMonth(m.month).slice(0, 1).toUpperCase(),
              selected: period.kind === "month" && m.month === period.key,
              title:
                m.watts === null
                  ? `${monthLabel(m.month)} : pas assez de nuits complètes`
                  : `${monthLabel(m.month)} : ${formatNumber(m.watts)} W`,
              segments: [{ value: m.watts ?? 0, color: "bg-grid", label: "Talon" }],
            }))}
          />
        </div>
      )}
    </Card>
  );
}
