import type { ReactNode } from "react";
import { BaseloadCard } from "@/components/cards/baseload-card";
import { CategoriesOverviewCard, PeakCard, SolarCard } from "@/components/cards/overview-cards";
import { Icon } from "@/components/ui";
import { yearlyKwh } from "@/domain/baseload";
import { formatEurFromCents, formatKwh, formatNumber, formatPercent } from "@/lib/format";
import type { Overview } from "@/server/queries/overview";

// « Ce qu'il faut retenir » : un enseignement par sujet, une phrase calculée sur les données
// de la période ; le détail (carte complète) se déplie au clic. Les phrases ne disent que ce
// que l'appli mesure.

type Ok = Extract<Overview, { status: "ok" }>;

const eur = (cents: number) => formatEurFromCents(cents, 0);

function InsightCard({
  title,
  headline,
  detail,
  actions,
  children,
}: {
  title: string;
  headline: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <details className="group rounded-card border border-border bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-card p-5 pr-14 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[13px] font-semibold text-muted">{title}</span>
            <span className="text-[17px] leading-snug font-semibold text-pretty">{headline}</span>
            {detail && <span className="text-sm text-ink-soft text-pretty">{detail}</span>}
            <span className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold">
              <span className="group-open:hidden">Voir le détail</span>
              <span className="hidden group-open:inline">Masquer le détail</span>
              <span className="transition-transform group-open:rotate-90">
                <Icon name="chevron" size={14} />
              </span>
            </span>
          </span>
        </summary>
        <div className="border-t border-track p-5">{children}</div>
      </details>
      {actions && <div className="absolute top-2 right-2">{actions}</div>}
    </div>
  );
}

/** Heures creuses : ce que la part de nuit fait gagner, au prix des heures pleines. */
export function PeakInsight({ overview, actions }: { overview: Ok; actions?: ReactNode }) {
  const { peak } = overview;
  if (!peak) return null;
  const sum = peak.hp.kwh + peak.hc.kwh;
  const hpRate = peak.hp.kwh > 0 ? peak.hp.energyCents / peak.hp.kwh : null;
  const hcRate = peak.hc.kwh > 0 ? peak.hc.energyCents / peak.hc.kwh : null;
  const saving = hpRate !== null && hcRate !== null ? peak.hc.kwh * (hpRate - hcRate) : null;
  return (
    <InsightCard
      title="Heures creuses"
      actions={actions}
      headline={
        saving !== null && saving >= 100
          ? `≈ ${eur(saving)} de moins qu'au tarif des heures pleines`
          : `${formatPercent(peak.hc.kwh / sum)} de votre électricité en heures creuses`
      }
      detail={
        saving !== null && saving >= 100 && hpRate !== null && hcRate !== null
          ? `${formatKwh(peak.hc.kwh)} à ${formatEurFromCents(hcRate, 3)} € au lieu de ${formatEurFromCents(hpRate, 3)} €, soit ${formatPercent(peak.hc.kwh / sum)} de l'électricité achetée`
          : undefined
      }
    >
      <PeakCard overview={overview} flat />
    </InsightCard>
  );
}

/** Postes suivis : le plus gros poste et sa part de la consommation. */
export function CategoriesInsight({ overview }: { overview: Ok }) {
  const { categories, balance } = overview;
  const top = [...categories].sort((a, b) => b.kwh - a.kwh).slice(0, 3);
  const first = top[0];
  return (
    <InsightCard
      title="Postes suivis"
      headline={
        first && balance.consumption > 0 && first.kwh > 0
          ? `${first.name} : ${formatPercent(first.kwh / balance.consumption)} de votre consommation`
          : "Aucun poste suivi sur cette période"
      }
      detail={
        top.length > 0 ? top.map((c) => `${c.name} ${formatKwh(c.kwh)}`).join(" · ") : undefined
      }
    >
      <CategoriesOverviewCard overview={overview} flat />
    </InsightCard>
  );
}

/** Talon de consommation : la puissance de fond, et son écart à l'an dernier. */
export function BaseloadInsight({ overview, actions }: { overview: Ok; actions?: ReactNode }) {
  const b = overview.baseload;
  if (!b) return null;
  return (
    <InsightCard
      title="Talon de consommation"
      actions={actions}
      headline={
        b.watts === null
          ? "Pas encore assez de nuits complètes pour le mesurer"
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
    >
      <BaseloadCard overview={overview} flat />
    </InsightCard>
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
    <InsightCard
      title="Production solaire"
      headline={
        solar.kwh > 0
          ? delta !== null && Math.abs(delta) >= 0.005
            ? `${formatKwh(solar.kwh)} produits, rendement ${delta > 0 ? "+" : "−"}${formatPercent(Math.abs(delta))} par rapport à l'an dernier`
            : `${formatKwh(solar.kwh)} produits`
          : "Aucune production reçue sur cette période"
      }
      detail={
        solar.kwh > 0 && sunshine > 0
          ? `Pour ${formatNumber(sunshine)} h de soleil${delta !== null ? ", à ensoleillement comparable" : ""}`
          : undefined
      }
    >
      <SolarCard overview={overview} flat />
    </InsightCard>
  );
}
