"use client";

import { useState } from "react";
import { StackedBars } from "@/components/charts/stacked-bars";
import { Card, StatTile, tiles } from "@/components/ui";
import { hourLabel } from "@/domain/forecast/summary";
import { formatEurFromCents, formatKwh } from "@/lib/format";
import { localParts } from "@/lib/time";

// Aujourd'hui ou demain heure par heure (T72, SPEC §7.14) : consommation prévue (couverte
// sur place ou achetée), production prévue en barre claire derrière, coût d'un kWh de plus
// en courbe. Toucher une heure affiche son détail.

export interface ForecastHourView {
  /** ISO, début de l'heure. */
  start: string;
  solarKwh: number;
  loadKwh: number;
  importKwh: number;
  exportKwh: number;
  /** Coût d'un kWh de plus (€), null sans contrat. */
  kwhCostEur: number | null;
}

export interface ForecastDayView {
  date: string;
  solarKwh: number;
  loadKwh: number;
  importKwh: number;
  exportKwh: number;
  costEur: number | null;
  /** ISO de l'heure où la batterie sera pleine, null sinon. */
  fullAt: string | null;
}

const COST_LINE = "var(--color-ink-soft)";
const kwh = (v: number) => formatKwh(v, v < 10 ? 1 : 0);
const eur = (v: number) => formatEurFromCents(v * 100, 2);

export function ForecastDay({
  days,
  hours,
  today,
  timezone,
  solar,
  battery,
}: {
  days: ForecastDayView[];
  hours: ForecastHourView[];
  today: string;
  timezone: string;
  solar: boolean;
  battery: boolean;
}) {
  const [date, setDate] = useState(days.at(-1)?.date ?? today);
  const [picked, setPicked] = useState<string | null>(null);
  const day = days.find((d) => d.date === date) ?? days[0];
  const list = hours.filter((h) => localParts(new Date(h.start), timezone).date === date);
  const focus = list.find((h) => h.start === picked) ?? null;
  const priced = list.some((h) => h.kwhCostEur !== null);
  const detail = (h: ForecastHourView) => {
    const start = new Date(h.start);
    const end = new Date(start.getTime() + 3_600_000);
    const covered = Math.max(0, h.loadKwh - h.importKwh);
    return `${hourLabel(start, timezone)} – ${hourLabel(end, timezone)} : ${kwh(h.loadKwh)} consommés, dont ${kwh(covered)} sur place et ${kwh(h.importKwh)} achetés${
      solar ? ` · production ${kwh(h.solarKwh)}` : ""
    }${h.kwhCostEur !== null ? ` · ${eur(h.kwhCostEur)} le kWh de plus` : ""}`;
  };
  if (!day) return null;

  return (
    <Card
      icon="sun"
      title={date === today ? "Aujourd'hui" : "Demain"}
      description="Prévisions heure par heure, d'après vos habitudes, la météo et votre contrat."
      actions={
        <div
          role="radiogroup"
          aria-label="Jour"
          className="flex gap-1 rounded-[10px] bg-chip p-[3px]"
        >
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              role="radio"
              aria-checked={d.date === date}
              onClick={() => {
                setDate(d.date);
                setPicked(null);
              }}
              className={`rounded-[8px] px-3 py-1 text-[13px] font-medium ${
                d.date === date ? "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-soft"
              }`}
            >
              {d.date === today ? "Aujourd'hui" : "Demain"}
            </button>
          ))}
        </div>
      }
    >
      <div className={tiles}>
        {solar && <StatTile label="Production prévue" value={kwh(day.solarKwh)} dot="bg-solar" />}
        <StatTile label="Consommation prévue" value={kwh(day.loadKwh)} />
        <StatTile
          label="Achats au réseau"
          value={kwh(day.importKwh)}
          sub={day.costEur !== null ? `≈ ${eur(day.costEur)} hors abonnement` : undefined}
          dot="bg-grid"
        />
        {battery ? (
          <StatTile
            label="Batterie pleine"
            value={day.fullAt ? `vers ${hourLabel(new Date(day.fullAt), timezone)}` : "non"}
            sub={day.fullAt ? undefined : "pas assez de surplus prévu"}
          />
        ) : (
          solar && <StatTile label="Surplus au réseau" value={kwh(day.exportKwh)} />
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-solar" />
          Couverte sur place
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-grid" />
          Achetée
        </span>
        {solar && (
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-solar/35" />
            Production prévue
          </span>
        )}
        {priced && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: COST_LINE }} />
            Coût d&apos;un kWh de plus
          </span>
        )}
      </div>
      <StackedBars
        height={150}
        ariaLabel={`Consommation et production prévues heure par heure, ${date === today ? "aujourd'hui" : "demain"}`}
        previousColor="bg-solar/35"
        bars={list.map((h, i) => {
          const start = new Date(h.start);
          return {
            key: h.start,
            label: i % 3 === 0 ? `${localParts(start, timezone).hour} h` : "",
            title: detail(h),
            selected: h.start === focus?.start,
            onSelect: () => setPicked(h.start === focus?.start ? null : h.start),
            segments: [
              {
                value: Math.max(0, h.loadKwh - h.importKwh),
                color: "bg-solar",
                label: "Couverte sur place",
              },
              { value: h.importKwh, color: "bg-grid", label: "Achetée" },
            ],
            previous: solar ? h.solarKwh : undefined,
          };
        })}
        line={priced ? { values: list.map((h) => h.kwhCostEur), color: COST_LINE } : undefined}
      />
      <p className="text-[11px] text-muted tabular-nums" aria-live="polite">
        {focus ? detail(focus) : "Touchez une heure pour son détail."}
      </p>
    </Card>
  );
}
