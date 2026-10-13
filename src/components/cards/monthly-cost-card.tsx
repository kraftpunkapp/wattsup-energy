"use client";

import { useEffect, useState } from "react";
import { StackedBars } from "@/components/charts/stacked-bars";
import { Card, Toggle } from "@/components/ui";
import { markedDays, markedMonths, type Marker } from "@/domain/markers";
import { monthLabel, shortMonth, type Period } from "@/domain/overview";
import { formatEurFromCents, formatKwh, formatPercent } from "@/lib/format";
import type { DayCost, MonthCost } from "@/server/queries/overview";

// Électricité mois par mois (vue année, chaque barre ouvre le mois) ou jour par jour (vue
// mois, avec la tendance sur 7 jours), en euros (abonnement en bas de chaque barre) ou en
// kWh soutirés, avec la même période de l'année précédente en option. L'unité et la
// comparaison sont mémorisées sur l'appareil.

type Unit = "eur" | "kwh";
const STORAGE_KEY = "wattsup:monthly-unit";
const COMPARE_KEY = "wattsup:monthly-compare";
const SUBSCRIPTION = "bg-subscription";
/** Couleur de la courbe de tendance (et de son repère dans la légende). */
const TREND = "var(--color-ink)";

const eur = (cents: number) => formatEurFromCents(cents, 0);
const kwh = (value: number) => formatKwh(value);

function UnitSwitch({ unit, onChange }: { unit: Unit; onChange: (u: Unit) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Unité du graphique"
      className="flex gap-1 rounded-[10px] bg-chip p-[3px]"
    >
      {(
        [
          { id: "eur", label: "€" },
          { id: "kwh", label: "kWh" },
        ] as const
      ).map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={unit === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-[8px] px-3 py-1 text-[13px] font-medium ${
            unit === o.id ? "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-soft"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-ink-soft">
        <span className={`size-2 rounded-[2px] ${color}`} />
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

const dayTitle = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export function MonthlyCostCard({
  months,
  days,
  period,
  markers,
}: {
  months: MonthCost[];
  /** Vue mois : un point par jour et la tendance ; null en vue année. */
  days: { list: DayCost[]; trend: { eur: (number | null)[]; kwh: (number | null)[] } } | null;
  period: Period;
  /** Repères de l'année : un point sous chaque mois concerné, texte dans l'info-bulle. */
  markers: Marker[];
}) {
  const [unit, setUnit] = useState<Unit>("eur");
  const [compare, setCompare] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "kwh") setUnit("kwh");
      if (localStorage.getItem(COMPARE_KEY) === "1") setCompare(true);
    } catch {
      // stockage indisponible : euros, sans comparaison
    }
  }, []);
  const remember = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // choix non mémorisé
    }
  };
  const choose = (u: Unit) => {
    setUnit(u);
    remember(STORAGE_KEY, u);
  };
  const toggleCompare = () => {
    setCompare(!compare);
    remember(COMPARE_KEY, compare ? "0" : "1");
  };

  const year = period.key.slice(0, 4);
  const selected = period.kind === "month" ? months.find((m) => m.key === period.key) : null;
  const sum = (pick: (m: MonthCost) => number) =>
    selected ? pick(selected) : months.reduce((a, m) => a + pick(m), 0);
  const totals = {
    energy: sum((m) => m.energyCents),
    subscription: sum((m) => m.subscriptionCents),
    kwh: sum((m) => m.kwh),
  };
  const isEur = unit === "eur";
  const marked = markedMonths(markers);
  const previousYear = String(Number(year) - 1);
  const hasPrevious = days ? days.list.some((d) => d.previous) : months.some((m) => m.previous);
  const comparing = compare && hasPrevious;
  // La tendance s'efface pendant la comparaison, comme l'ensoleillement : lisibilité.
  const trend = days && !comparing ? (isEur ? days.trend.eur : days.trend.kwh) : null;
  const showTrend = trend?.some((v) => v !== null) ?? false;
  type Figures = { energyCents: number; subscriptionCents: number; kwh: number };
  const valueOf = (m: Figures) => (isEur ? m.energyCents + m.subscriptionCents : m.kwh);
  const segmentsOf = (m: Figures) =>
    isEur
      ? [
          { value: m.subscriptionCents, color: SUBSCRIPTION, label: "Abonnement" },
          { value: m.energyCents, color: "bg-grid", label: "Consommation" },
        ]
      : [{ value: m.kwh, color: "bg-grid", label: "Soutiré" }];
  const fmt = (v: number) => (isEur ? eur(v) : kwh(v));
  const scope = selected ? [selected] : months;
  const previousTotal = scope.every((m) => m.previous)
    ? scope.reduce((a, m) => a + (m.previous ? valueOf(m.previous) : 0), 0)
    : null;
  const currentTotal = isEur ? totals.energy + totals.subscription : totals.kwh;

  const monthBars = months.map((m) => ({
    key: m.key,
    label: shortMonth(m.key),
    href: `/?p=${m.key}`,
    selected: period.kind === "month" && m.key === period.key,
    title: `${monthLabel(m.key)} : ${fmt(valueOf(m))}${
      comparing && m.previous
        ? ` · ${monthLabel(`${previousYear}${m.key.slice(4)}`)} : ${fmt(valueOf(m.previous))}`
        : ""
    }${(marked.get(m.key) ?? []).map((x) => ` · ${x.text}`).join("")}`,
    previous: comparing ? (m.previous ? valueOf(m.previous) : null) : undefined,
    marked: marked.has(m.key),
    segments: segmentsOf(m),
  }));
  const dayMarks = days ? markedDays(markers, period.from, period.to) : new Map<string, Marker[]>();
  const dayBars = (days?.list ?? []).map((d, i) => ({
    key: d.key,
    label: i % 7 === 0 ? String(Number(d.key.slice(8))) : "",
    title: `${dayTitle(d.key)} : ${d.hasData ? fmt(valueOf(d)) : "pas de donnée"}${
      comparing && d.previous ? ` · ${previousYear} : ${fmt(valueOf(d.previous))}` : ""
    }${(dayMarks.get(d.key) ?? []).map((x) => ` · ${x.text}`).join("")}`,
    previous: comparing ? (d.previous ? valueOf(d.previous) : null) : undefined,
    marked: dayMarks.has(d.key),
    segments: segmentsOf(d),
  }));
  const markedCount = days ? dayMarks.size : marked.size;

  const prevLabel = selected
    ? monthLabel(`${previousYear}${selected.key.slice(4)}`)
    : `mêmes mois ${previousYear}`;
  const comparison = comparing && previousTotal !== null && (
    <div className="flex items-center justify-between gap-2 text-ink-soft">
      <span>{prevLabel.charAt(0).toUpperCase() + prevLabel.slice(1)}</span>
      <span className="whitespace-nowrap tabular-nums">
        {fmt(previousTotal)}
        {/* Période en cours : comparer un mois entamé à un mois entier tromperait. */}
        {period.complete && previousTotal > 0 && (
          <span className={currentTotal <= previousTotal ? "text-positive" : "text-negative"}>
            {" "}
            ({currentTotal <= previousTotal ? "−" : "+"}
            {formatPercent(Math.abs(currentTotal / previousTotal - 1))})
          </span>
        )}
      </span>
    </div>
  );

  return (
    <Card
      title={
        days
          ? isEur
            ? `Coût de l'électricité par jour · ${period.label}`
            : `Électricité soutirée par jour · ${period.label}`
          : isEur
            ? `Coût mensuel de l'électricité · ${year}`
            : `Électricité soutirée par mois · ${year}`
      }
      description={`${
        isEur
          ? "Contrat et prix en vigueur chaque jour, abonnement compris."
          : "Énergie achetée au réseau."
      }${days ? "" : " Touchez un mois pour le détail."}`}
      actions={<UnitSwitch unit={unit} onChange={choose} />}
    >
      <div className="flex flex-wrap items-stretch gap-5">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2">
          {hasPrevious && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
              <Toggle
                label={`Comparer à ${previousYear}`}
                checked={compare}
                onChange={toggleCompare}
              />
              {comparing && (
                <span className="flex gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-[2px] bg-grid" />
                    {year}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-[2px] bg-grid/25" />
                    {previousYear}
                  </span>
                </span>
              )}
            </div>
          )}
          <StackedBars
            ariaLabel={`${isEur ? "Coût de l'électricité" : "Électricité soutirée au réseau"} par ${
              days ? `jour, ${period.label}` : `mois en ${year}`
            }`}
            bars={days ? dayBars : monthBars}
            line={showTrend && trend ? { values: trend, color: TREND, barScale: true } : undefined}
          />
          {(showTrend || markedCount > 0) && (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
              {showTrend && (
                <span className="flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: TREND }} />
                  Tendance (moyenne sur 7 jours)
                </span>
              )}
              {markedCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="size-[5px] rounded-full bg-ink" />
                  {days ? "Repère : survolez le jour pour le lire." : "Repère : touchez le mois pour le lire."}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex grow basis-[220px] flex-col gap-2.5 rounded-control bg-bg p-4 text-[13px] md:grow-0">
          <h3 className="font-semibold capitalize">{period.label}</h3>
          {isEur ? (
            <>
              <Row color="bg-grid" label="Consommation" value={eur(totals.energy)} />
              <Row color={SUBSCRIPTION} label="Abonnement" value={eur(totals.subscription)} />
              <div className="mt-auto flex justify-between border-t border-border-strong pt-2.5 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{eur(totals.energy + totals.subscription)}</span>
              </div>
              {comparison}
            </>
          ) : (
            <>
              <Row color="bg-grid" label="Soutiré au réseau" value={kwh(totals.kwh)} />
              {comparison}
              {totals.kwh > 0 && totals.energy > 0 && (
                <div className="mt-auto flex justify-between gap-3 border-t border-border-strong pt-2.5">
                  <span className="text-ink-soft">Prix moyen du kWh, hors abonnement</span>
                  <span className="font-semibold whitespace-nowrap tabular-nums">
                    {formatEurFromCents(totals.energy / totals.kwh, 3)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
