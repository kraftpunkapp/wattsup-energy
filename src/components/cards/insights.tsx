import type { ReactNode } from "react";
import { InsightTile } from "@/components/cards/insight-grid";
import { DeltaChip, Gauge, Icon } from "@/components/ui";
import { categoryIcon } from "@/components/ui/category";
import { yearlyKwh } from "@/domain/baseload";
import { shortMonth } from "@/domain/overview";
import { formatEurFromCents, formatKwh, formatNumber, formatPercent } from "@/lib/format";
import type { Overview } from "@/server/queries/overview";

// « Ce qu'il faut retenir » : un enseignement par sujet, une phrase calculée sur les données
// de la période et un petit graphique quand elles le permettent ; le détail (carte complète)
// se déplie au clic, sous la rangée (InsightGrid). Les phrases ne disent que ce que l'appli
// mesure.

type Ok = Extract<Overview, { status: "ok" }>;

const eur = (cents: number) => formatEurFromCents(cents, 0);

/** Heures creuses : ce que la part de nuit fait gagner, au prix des heures pleines. */
export function PeakInsight({ overview, actions }: { overview: Ok; actions?: ReactNode }) {
  const { peak } = overview;
  if (!peak) return null;
  const sum = peak.hp.kwh + peak.hc.kwh;
  const hpRate = peak.hp.kwh > 0 ? peak.hp.energyCents / peak.hp.kwh : null;
  const hcRate = peak.hc.kwh > 0 ? peak.hc.energyCents / peak.hc.kwh : null;
  const saving = hpRate !== null && hcRate !== null ? peak.hc.kwh * (hpRate - hcRate) : null;
  const share = sum > 0 ? peak.hc.kwh / sum : 0;
  return (
    <InsightTile
      id="peak"
      icon="moon"
      tone="hc"
      title="Heures creuses"
      actions={actions}
      headline={
        saving !== null && saving >= 100
          ? `≈ ${eur(saving)} de moins qu'au tarif des heures pleines`
          : `${formatPercent(share)} de votre électricité en heures creuses`
      }
      detail={
        saving !== null && saving >= 100 && hpRate !== null && hcRate !== null
          ? `${formatKwh(peak.hc.kwh)} à ${formatNumber(hcRate, 1)} c€/kWh au lieu de ${formatNumber(hpRate, 1)} c€/kWh`
          : undefined
      }
      visual={
        sum > 0 && (
          <div className="flex flex-col gap-1.5">
            <Gauge
              key="gauge"
              height={10}
              label={`Heures creuses ${formatPercent(share)}, heures pleines ${formatPercent(1 - share)}`}
              parts={[
                { value: peak.hc.kwh, color: "bg-hc" },
                { value: peak.hp.kwh, color: "bg-grid" },
              ]}
            />
            <span key="share" className="text-[13px] font-semibold text-ink-soft">
              {formatPercent(share)} de l&apos;électricité achetée en heures creuses
            </span>
          </div>
        )
      }
    />
  );
}

/** Postes suivis : le plus gros poste et sa part de la consommation. */
export function CategoriesInsight({ overview }: { overview: Ok }) {
  const { categories, balance } = overview;
  const top = [...categories].sort((a, b) => b.kwh - a.kwh).slice(0, 3);
  const first = top[0];
  return (
    <InsightTile
      id="categories"
      icon={first ? categoryIcon(first.icon) : "plug"}
      tone="neutral"
      title="Postes suivis"
      headline={
        first && balance.consumption > 0 && first.kwh > 0
          ? `${first.name} : ${formatPercent(first.kwh / balance.consumption)} de votre consommation`
          : "Aucun poste suivi sur cette période"
      }
      visual={
        top.length > 0 && (
          <ul className="flex flex-col gap-2">
            {top.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 text-sm">
                <span
                  aria-hidden
                  className="flex size-[30px] flex-none items-center justify-center rounded-lg bg-bg text-ink-soft"
                >
                  <Icon name={categoryIcon(c.icon)} size={16} />
                </span>
                <span className="min-w-0 flex-1 text-pretty">{c.name}</span>
                <strong className="tabular-nums">{formatKwh(c.kwh)}</strong>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}

/** Talon de consommation : la puissance de fond, et son écart à l'an dernier. */
export function BaseloadInsight({ overview, actions }: { overview: Ok; actions?: ReactNode }) {
  const b = overview.baseload;
  if (!b) return null;
  const measured = b.months.filter((m) => m.watts !== null);
  const peak = Math.max(...measured.map((m) => m.watts ?? 0), 0);
  const delta = b.watts !== null && b.previousWatts ? b.watts / b.previousWatts - 1 : null;
  return (
    <InsightTile
      id="baseload"
      icon="plug"
      tone="neutral"
      title="Talon de conso."
      actions={actions}
      headline={
        b.watts === null
          ? "Pas encore mesurable"
          : `${formatNumber(b.watts)} W en permanence${
              b.previousWatts !== null
                ? `, contre ${formatNumber(b.previousWatts)} W un an plus tôt`
                : ""
            }`
      }
      detail={
        b.watts === null
          ? undefined
          : `À ce niveau, ≈ ${formatKwh(yearlyKwh(b.watts))} par an pour ce qui tourne en permanence`
      }
      visual={
        b.watts === null ? (
          <span className="rounded-control border border-dashed border-dash px-3 py-3 text-[13px] text-muted text-pretty">
            Il faut au moins 7 nuits complètes (minuit à 6 h) sur la période pour mesurer ce que la
            maison consomme en permanence.
          </span>
        ) : (
          peak > 0 && (
            <div className="flex flex-col gap-1.5">
              <span
                key="bars"
                role="img"
                aria-label={`Talon des ${b.months.length} derniers mois, de ${shortMonth(b.months[0].month)} à ${shortMonth(b.months[b.months.length - 1].month)}`}
                className="flex h-[30px] items-end gap-[3px]"
              >
                {b.months.map((m, i) => (
                  <span
                    key={m.month}
                    className={`wu-grow-y flex-1 rounded-[2px] ${
                      i === b.months.length - 1 ? "bg-grid" : "bg-grid/25"
                    }`}
                    style={{
                      height: `${Math.max(((m.watts ?? 0) / peak) * 100, m.watts ? 8 : 0)}%`,
                    }}
                  />
                ))}
              </span>
              {delta !== null && Math.abs(delta) >= 0.005 && (
                <span key="delta" className="flex flex-wrap items-center gap-1.5 text-[13px]">
                  <DeltaChip tone={delta < 0 ? "gain" : "cost"}>
                    {delta < 0 ? "−" : "+"}
                    {formatPercent(Math.abs(delta))}
                  </DeltaChip>
                  par rapport à l&apos;an dernier
                </span>
              )}
            </div>
          )
        )
      }
    />
  );
}

/** Production solaire : kWh produits et rendement comparé à l'an dernier. */
export function SolarInsight({ overview }: { overview: Ok }) {
  const { solar } = overview;
  if (!solar) return null;
  const delta =
    solar.yield !== null && solar.previousYield ? solar.yield / solar.previousYield - 1 : null;
  const sunshine = solar.points.reduce((a, p) => a + (p.sunshineHours ?? 0), 0);
  return (
    <InsightTile
      id="solar"
      icon="sun"
      tone="solar"
      title="Solaire"
      headline={
        solar.kwh > 0
          ? `${formatKwh(solar.kwh)} produits`
          : "Aucune production reçue sur cette période"
      }
      chip={
        solar.kwh > 0 && delta !== null && Math.abs(delta) >= 0.005 ? (
          <DeltaChip tone={delta > 0 ? "gain" : "cost"}>
            Rendement {delta > 0 ? "+" : "−"}
            {formatPercent(Math.abs(delta))} vs {Number(overview.period.key.slice(0, 4)) - 1}
          </DeltaChip>
        ) : undefined
      }
      detail={
        solar.kwh > 0 && sunshine > 0
          ? `Pour ${formatNumber(sunshine)} h de soleil${delta !== null ? ", à ensoleillement comparable" : ""}`
          : undefined
      }
    />
  );
}
