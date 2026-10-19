"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StackedBars } from "@/components/charts/stacked-bars";
import { button, Card, Toggle } from "@/components/ui";
import { markedDays, markedMonths, type Marker } from "@/domain/markers";
import { monthLabel, shortMonth, type Period } from "@/domain/overview";
import { formatEurFromCents, formatKwh, formatPercent } from "@/lib/format";
import type { DayCost, MonthCost } from "@/server/queries/overview";

// Électricité mois par mois (vue année, chaque barre ouvre le mois) ou jour par jour (vue
// mois), en euros (abonnement en bas de chaque barre) ou en kWh soutirés, avec la même
// période de l'année précédente en option. En vue mois, toucher un jour affiche ses chiffres
// dans le panneau (T61). L'unité et la comparaison sont mémorisées sur l'appareil.

type Unit = "eur" | "kwh";
const STORAGE_KEY = "wattsup:monthly-unit";
const COMPARE_KEY = "wattsup:monthly-compare";
const SUBSCRIPTION = "bg-subscription";

const eur = (cents: number) => formatEurFromCents(cents, 0);
/** Un jour se compte en centimes : arrondi à l'euro, il ne dirait rien. */
const eurDay = (cents: number) => formatEurFromCents(cents, 2);
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
  priced,
}: {
  months: MonthCost[];
  /** Faux : aucun contrat pour chiffrer l'électricité, le graphique reste en kWh (T63). */
  priced: boolean;
  /** Vue mois : une barre par jour ; null en vue année. */
  days: DayCost[] | null;
  period: Period;
  /** Repères de l'année : un point sous chaque mois concerné, texte dans l'info-bulle. */
  markers: Marker[];
}) {
  const [unit, setUnit] = useState<Unit>("eur");
  // Jour touché, rattaché à sa période : changer de mois efface la sélection.
  const [picked, setPicked] = useState<{ period: string; day: string } | null>(null);
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
  const focusDay =
    picked?.period === period.key ? (days?.find((d) => d.key === picked.day) ?? null) : null;
  const sum = (pick: (m: MonthCost) => number) =>
    selected ? pick(selected) : months.reduce((a, m) => a + pick(m), 0);
  const totals = focusDay
    ? { energy: focusDay.energyCents, subscription: focusDay.subscriptionCents, kwh: focusDay.kwh }
    : {
        energy: sum((m) => m.energyCents),
        subscription: sum((m) => m.subscriptionCents),
        kwh: sum((m) => m.kwh),
      };
  const isEur = priced && unit === "eur";
  const marked = markedMonths(markers);
  const previousYear = String(Number(year) - 1);
  const hasPrevious = days ? days.some((d) => d.previous) : months.some((m) => m.previous);
  const comparing = compare && hasPrevious;
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
  const fmtDay = (v: number) => (isEur ? eurDay(v) : kwh(v));
  // Panneau : au centime pour un jour touché, à l'euro pour un mois ou l'année.
  const money = focusDay ? eurDay : eur;
  const scope = selected ? [selected] : months;
  const previousTotal = focusDay
    ? focusDay.previous && valueOf(focusDay.previous)
    : scope.every((m) => m.previous)
      ? scope.reduce((a, m) => a + (m.previous ? valueOf(m.previous) : 0), 0)
      : null;
  // Écart en % seulement sur une période terminée (le jour en cours ne l'est pas).
  const complete = focusDay
    ? period.complete || focusDay.key !== days?.at(-1)?.key
    : period.complete;
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
  const dayBars = (days ?? []).map((d, i) => ({
    key: d.key,
    label: i % 7 === 0 ? String(Number(d.key.slice(8))) : "",
    selected: d.key === focusDay?.key,
    onSelect: () => setPicked(d.key === focusDay?.key ? null : { period: period.key, day: d.key }),
    title: `${dayTitle(d.key)} : ${d.hasData ? fmtDay(valueOf(d)) : "pas de donnée"}${
      comparing && d.previous ? ` · ${previousYear} : ${fmtDay(valueOf(d.previous))}` : ""
    }${(dayMarks.get(d.key) ?? []).map((x) => ` · ${x.text}`).join("")}`,
    previous: comparing ? (d.previous ? valueOf(d.previous) : null) : undefined,
    marked: dayMarks.has(d.key),
    segments: segmentsOf(d),
  }));
  const markedCount = days ? dayMarks.size : marked.size;

  const prevLabel = focusDay
    ? dayTitle(
        `${Number(focusDay.key.slice(0, 4)) - 1}${focusDay.key.slice(4)}`.replace(
          /-02-29$/,
          "-02-28",
        ),
      )
    : selected
      ? monthLabel(`${previousYear}${selected.key.slice(4)}`)
      : `mêmes mois ${previousYear}`;
  const comparison = comparing && previousTotal !== null && (
    <div className="flex items-center justify-between gap-2 text-ink-soft">
      <span>{prevLabel.charAt(0).toUpperCase() + prevLabel.slice(1)}</span>
      <span className="whitespace-nowrap tabular-nums">
        {focusDay ? fmtDay(previousTotal) : fmt(previousTotal)}
        {/* Période en cours : comparer un mois entamé à un mois entier tromperait. */}
        {complete && previousTotal > 0 && (
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
      }${days ? " Touchez un jour pour son détail." : " Touchez un mois pour le détail."}`}
      actions={priced ? <UnitSwitch unit={unit} onChange={choose} /> : undefined}
    >
      {!priced && (
        <p className="text-xs text-muted">
          Sans contrat, l&apos;électricité s&apos;affiche en kWh.{" "}
          <Link href="/contrats" className="font-medium text-ink underline underline-offset-2">
            Ajoutez votre contrat
          </Link>{" "}
          pour la chiffrer.
        </p>
      )}
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
          />
          {markedCount > 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="size-[5px] rounded-full bg-ink" />
              {days
                ? "Repère : touchez le jour pour le lire."
                : "Repère : touchez le mois pour le lire."}
            </p>
          )}
        </div>
        <div className="flex grow basis-[220px] flex-col gap-2.5 rounded-control bg-bg p-4 text-[13px] md:grow-0">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className={`font-semibold ${focusDay ? "" : "capitalize"}`}>
              {focusDay ? dayTitle(focusDay.key) : period.label}
            </h3>
            {focusDay && (
              <button type="button" className={button.link} onClick={() => setPicked(null)}>
                Tout le mois
              </button>
            )}
          </div>
          {focusDay &&
            (dayMarks.get(focusDay.key) ?? []).map((m) => (
              <p
                key={`${m.startDate}${m.text}`}
                className="flex items-center gap-1.5 text-xs text-ink-soft"
              >
                <span className="size-[5px] flex-none rounded-full bg-ink" />
                {m.text}
              </p>
            ))}
          {focusDay && !focusDay.hasData ? (
            <p className="text-muted">Pas de donnée reçue ce jour-là.</p>
          ) : isEur ? (
            <>
              <Row color="bg-grid" label="Consommation" value={money(totals.energy)} />
              <Row color={SUBSCRIPTION} label="Abonnement" value={money(totals.subscription)} />
              <div className="mt-auto flex justify-between border-t border-border-strong pt-2.5 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(totals.energy + totals.subscription)}</span>
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
