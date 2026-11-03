import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLink, Card, Icon } from "@/components/ui";
import type { Advice } from "@/domain/advice";
import type { ApplianceIcon } from "@/domain/forecast/appliances";
import { windowLabel } from "@/domain/forecast/summary";
import { formatEurFromCents, formatPercent } from "@/lib/format";
import { settingsHref } from "@/lib/settings-tabs";
import type { ForecastPlan } from "@/server/forecast";

// « Quand consommer » (T48), devenue « Demain » avec les prévisions horaires (T72) : les
// meilleurs créneaux des appareils d'abord, puis la couleur Tempo et les heures creuses. Le
// surplus solaire « habituel » cède la place à la prévision quand elle existe.

const DOT: Record<Advice["tone"], string> = {
  warning: "bg-ink",
  positive: "bg-solar",
  info: "bg-hc",
};

export interface WindowTip {
  id: string;
  icon: ApplianceIcon;
  name: string;
  /** « demain, 13 h – 15 h ». */
  when: string;
  /** « ≈ 0,12 € · 80 % solaire ». */
  detail: string;
  /** Gain face à un lancement immédiat (€), 0 si aucun. */
  savingEur: number;
}

/** Écart sous lequel un créneau ne fait rien gagner (€). */
const SAVING_MIN_EUR = 0.05;
const eur = (v: number) => formatEurFromCents(v * 100, 2);

/** Les 3 prochains créneaux utiles (gain ou surplus solaire) d'un plan de prévisions. */
export function windowTips(plan: ForecastPlan, timezone: string): WindowTip[] {
  if (plan.status !== "ok") return [];
  return [...plan.windows]
    .sort((a, b) => (a.window?.start.getTime() ?? 0) - (b.window?.start.getTime() ?? 0))
    .flatMap(({ appliance, window }) => {
      if (!window) return [];
      const saving = window.nowCostEur - window.costEur;
      if (saving < SAVING_MIN_EUR && window.solarShare < 0.5) return [];
      const parts = [`≈ ${eur(window.costEur)}`];
      if (window.solarShare >= 0.5) parts.push(`${formatPercent(window.solarShare)} solaire`);
      if (saving >= SAVING_MIN_EUR) parts.push(`${eur(saving)} de moins que tout de suite`);
      return [
        {
          id: appliance.id,
          icon: appliance.icon,
          name: appliance.name,
          when: windowLabel(window.start, window.end, plan.today, timezone),
          detail: parts.join(" · "),
          savingEur: Math.max(0, saving),
        },
      ];
    })
    .slice(0, 3);
}

export function AdviceCard({
  advice,
  forecast,
  actions,
}: {
  advice: Advice[];
  /** Prévisions horaires disponibles : créneaux (au plus 3) et nombre d'appareils. */
  forecast: { windows: WindowTip[]; appliances: number } | null;
  actions?: ReactNode;
}) {
  const tips = forecast ? advice.filter((a) => a.id !== "surplus") : advice;
  if (tips.length === 0 && !forecast) return null;
  if (forecast && forecast.windows.length > 0) {
    const saving = forecast.windows.reduce((a, w) => a + w.savingEur, 0);
    return (
      <section className="rounded-card border border-border bg-surface px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-[1_1_320px] items-center gap-3">
            <span
              aria-hidden
              className="flex size-10 flex-none items-center justify-center rounded-xl bg-bg text-ink"
            >
              <Icon name="moon" size={20} />
            </span>
            <div className="flex flex-col gap-0.5">
              <h2 className="text-[15px] font-bold">
                Demain : les bons créneaux pour vos appareils
              </h2>
              {saving >= SAVING_MIN_EUR && (
                <p className="text-sm text-ink-soft">
                  ≈ {eur(saving)} de moins qu&apos;en les lançant tout de suite
                </p>
              )}
            </div>
          </div>
          <ul className="flex flex-wrap gap-2">
            {forecast.windows.map((w) => (
              <li
                key={w.id}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-bg px-3 text-sm whitespace-nowrap"
              >
                <Icon name={w.icon} size={14} />
                <strong>{w.name}</strong>
                <span className="wu-mono text-xs">
                  {w.when.startsWith("demain, ") ? w.when.slice(8) : w.when}
                </span>
              </li>
            ))}
          </ul>
          <div className="ml-auto flex items-center gap-2">
            <ArrowLink href="/previsions">Voir les prévisions</ArrowLink>
            {actions}
          </div>
        </div>
      </section>
    );
  }
  return (
    <Card
      icon="sun"
      title={forecast ? "Demain" : "Quand consommer"}
      actions={actions}
      description={
        forecast
          ? "Quand lancer vos appareils, d'après vos prévisions, et ce que dit votre contrat."
          : "Les heures où votre électricité coûte le moins, d'après vos données et votre contrat."
      }
    >
      <ul className="flex flex-col">
        {forecast?.windows.map((w) => (
          <li
            key={w.id}
            className="flex gap-3 border-t border-track py-3 first:border-t-0 first:pt-0 last:pb-0"
          >
            <span className="mt-0.5 flex-none text-ink-soft">
              <Icon name={w.icon} size={16} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold">
                {w.name} : {w.when}
              </span>
              <span className="text-[13px] text-muted tabular-nums">{w.detail}</span>
            </span>
          </li>
        ))}
        {forecast && forecast.appliances === 0 && (
          <li className="flex gap-3 border-t border-track py-3 first:border-t-0 first:pt-0 last:pb-0">
            <span className="mt-0.5 flex-none text-ink-soft">
              <Icon name="plus" size={16} />
            </span>
            <span className="text-[13px] text-muted text-pretty">
              <Link
                href={settingsHref("appareils")}
                className="font-medium text-ink underline underline-offset-2"
              >
                Ajoutez vos appareils
              </Link>{" "}
              (lave-linge, ballon, véhicule…) pour savoir quand les lancer.
            </span>
          </li>
        )}
        {tips.map((a) => (
          <li
            key={a.id}
            className="flex gap-3 border-t border-track py-3 first:border-t-0 first:pt-0 last:pb-0"
          >
            <span className={`mt-1.5 size-2 flex-none rounded-full ${DOT[a.tone]}`} aria-hidden />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-semibold">{a.title}</span>
              <span className="text-[13px] text-muted text-pretty">{a.text}</span>
            </span>
          </li>
        ))}
      </ul>
      {forecast && <ArrowLink href="/previsions">Voir les prévisions heure par heure</ArrowLink>}
    </Card>
  );
}
