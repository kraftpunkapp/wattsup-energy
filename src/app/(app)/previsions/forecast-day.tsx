"use client";

import { useState, type ReactNode } from "react";
import { StackedBars } from "@/components/charts/stacked-bars";
import { Card, Gauge, Legend, Segmented, StatTile, tiles } from "@/components/ui";
import { hourLabel } from "@/domain/forecast/summary";
import { formatEurFromCents, formatKwh, formatPercent } from "@/lib/format";
import { localParts } from "@/lib/time";

// Aujourd'hui ou demain heure par heure (T72, SPEC §7.14) : consommation prévue (couverte
// sur place ou achetée), production prévue en barre claire derrière, coût d'un kWh de plus
// en courbe. Toucher une heure affiche son détail. Aujourd'hui, les heures écoulées montrent
// le mesuré et les heures à venir, plus claires, la prévision ; la consommation prévue suit
// en courbe, pleine sur les heures écoulées (ce qui était prévu), en pointillés ensuite.

export interface ForecastHourView {
  /** ISO, début de l'heure. */
  start: string;
  solarKwh: number;
  loadKwh: number;
  importKwh: number;
  exportKwh: number;
  /** Coût d'un kWh de plus (€), null sans contrat. */
  kwhCostEur: number | null;
  /** Prix du kWh acheté à cette heure (€), null sans contrat. */
  priceEur: number | null;
  /** Part de l'heure en heures creuses (0–1), null sans heures creuses au contrat. */
  offPeakShare: number | null;
  /** Heure écoulée : valeurs mesurées. */
  measured: boolean;
  /** Heure écoulée : ce qui était estimé (prévision figée la veille, sinon le modèle). */
  estimated: { solarKwh: number; loadKwh: number } | null;
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
  /** Part déjà mesurée (aujourd'hui). */
  measured: { solarKwh: number; loadKwh: number; hours: number };
}

const COST_LINE = "var(--color-hc)";
const FORECAST_LINE = "var(--color-ink)";
/** Heures encore prévues d'un jour en partie mesuré (classes écrites en entier pour Tailwind). */
const FORECAST_TONE = { "bg-solar": "bg-solar/55", "bg-grid": "bg-grid/55" } as const;
const kwh = (v: number) => formatKwh(v, v < 10 ? 1 : 0);
const eur = (v: number) => formatEurFromCents(v * 100, 2);

export function ForecastDay({
  days,
  hours,
  today,
  timezone,
  solar,
  battery,
  windows,
  why,
}: {
  windows: ReactNode;
  why: ReactNode;
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
  // Jour en partie mesuré : les heures prévues sont plus claires.
  const mixed = list.some((h) => h.measured) && list.some((h) => !h.measured);
  // Heures écoulées avec leur estimation : bilan « depuis minuit ».
  const past = list.filter((h) => h.estimated !== null);
  const sum = (pick: (h: ForecastHourView) => number) => past.reduce((a, h) => a + pick(h), 0);
  const tone = (h: ForecastHourView, color: keyof typeof FORECAST_TONE) =>
    mixed && !h.measured ? FORECAST_TONE[color] : color;
  const detail = (h: ForecastHourView) => {
    const start = new Date(h.start);
    const end = new Date(start.getTime() + 3_600_000);
    const covered = Math.max(0, h.loadKwh - h.importKwh);
    const e = h.estimated;
    return `${hourLabel(start, timezone)} – ${hourLabel(end, timezone)}, ${h.measured ? "mesuré" : "prévu"} : ${kwh(h.loadKwh)} consommés${
      e ? ` (${kwh(e.loadKwh)} prévus)` : ""
    }, dont ${kwh(covered)} sur place et ${kwh(h.importKwh)} achetés${
      solar ? ` · production ${kwh(h.solarKwh)}${e ? ` (${kwh(e.solarKwh)} prévus)` : ""}` : ""
    }${!h.measured && h.kwhCostEur !== null ? ` · ${eur(h.kwhCostEur)} le kWh de plus` : ""}`;
  };
  if (!day) return null;

  const chart = (
    <>
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
        {past.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full bg-ink" />
            Consommation prévue
            <span className="w-5 border-t-2 border-dashed border-ink" />à venir
          </span>
        )}
        {mixed && <span>Heures écoulées : mesuré ; à venir, plus clair : prévu</span>}
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
                color: tone(h, "bg-solar"),
                label: "Couverte sur place",
              },
              { value: h.importKwh, color: tone(h, "bg-grid"), label: "Achetée" },
            ],
            previous: solar ? h.solarKwh : undefined,
          };
        })}
        line={[
          ...(priced
            ? // Le coût d'un kWh de plus ne concerne que les heures à venir.
              [{ values: list.map((h) => (h.measured ? null : h.kwhCostEur)), color: COST_LINE }]
            : []),
          ...(past.length > 0
            ? [
                // Ce qui était prévu pour les heures écoulées…
                {
                  values: list.map((h) => h.estimated?.loadKwh ?? null),
                  color: FORECAST_LINE,
                  barScale: true,
                },
                // … puis la prévision, en pointillés, reliée à la dernière heure écoulée.
                {
                  values: list.map((h, i) =>
                    !h.measured
                      ? h.loadKwh
                      : list[i + 1] && !list[i + 1]?.measured
                        ? (h.estimated?.loadKwh ?? null)
                        : null,
                  ),
                  color: FORECAST_LINE,
                  barScale: true,
                  dashed: true,
                },
              ]
            : []),
        ]}
      />
      {past.length > 0 && (
        <p className="text-[13px] text-ink-soft tabular-nums">
          Depuis minuit : {kwh(sum((h) => h.loadKwh))} consommés pour{" "}
          {kwh(sum((h) => h.estimated?.loadKwh ?? 0))} prévus
          {solar &&
            ` · ${kwh(sum((h) => h.solarKwh))} produits pour ${kwh(sum((h) => h.estimated?.solarKwh ?? 0))} prévus`}
          .
        </p>
      )}
      <p className="text-[11px] text-muted tabular-nums" aria-live="polite">
        {focus ? detail(focus) : "Touchez une heure pour son détail."}
      </p>
    </>
  );
  const tomorrow = date !== today;
  const switcher = (
    <Segmented
      label="Jour"
      value={date}
      onChange={(d) => {
        setDate(d);
        setPicked(null);
      }}
      options={days.map((d) => ({
        value: d.date,
        label: d.date === today ? "Aujourd'hui" : "Demain",
      }))}
    />
  );

  if (tomorrow) {
    // Origine de l'électricité consommée : réseau, panneaux en direct, batterie.
    const dayHours = list;
    const covered = (h: ForecastHourView) => Math.max(0, h.loadKwh - h.importKwh);
    const direct = dayHours.reduce((a, h) => a + Math.min(h.solarKwh, covered(h)), 0);
    const stored = dayHours.reduce((a, h) => a + covered(h) - Math.min(h.solarKwh, covered(h)), 0);
    const offPeakKwh = dayHours.reduce((a, h) => a + h.importKwh * (h.offPeakShare ?? 0), 0);
    const hasOffPeak = dayHours.some((h) => h.offPeakShare !== null);
    const avoided = dayHours.reduce((a, h) => a + covered(h) * (h.priceEur ?? 0), 0);
    const parts = [
      { label: "Réseau", kwh: day.importKwh, color: "bg-grid" },
      ...(solar ? [{ label: "Panneaux", kwh: direct, color: "bg-solar" }] : []),
      ...(battery ? [{ label: "Batterie", kwh: stored, color: "bg-battery" }] : []),
    ];
    return (
      <>
        <div className="flex">{switcher}</div>
        <section
          aria-labelledby="achats"
          className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6 sm:p-7"
        >
          <h2 id="achats" className="text-[15px] font-semibold text-muted">
            Achats au réseau prévus demain
          </h2>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <p className="text-[56px] leading-none font-bold tracking-[-0.03em] tabular-nums">
              {day.costEur !== null ? `≈ ${eur(day.costEur)}` : kwh(day.importKwh)}
            </p>
            <p className="text-base text-ink-soft tabular-nums">
              {kwh(day.importKwh)} achetés
              {hasOffPeak && day.importKwh > 0
                ? `, dont ${formatPercent(offPeakKwh / day.importKwh)} en heures creuses`
                : ""}
              {day.costEur !== null ? " · hors abonnement" : ""}
            </p>
          </div>
          <p className="text-sm text-ink-soft tabular-nums">
            Consommation prévue : {kwh(day.loadKwh)}
            {battery &&
              day.fullAt &&
              ` · batterie pleine vers ${hourLabel(new Date(day.fullAt), timezone)}`}
          </p>
          {parts.length > 1 && (
            <>
              <Gauge
                parts={parts.map((p) => ({ value: p.kwh, color: p.color }))}
                label={`Consommation prévue demain : ${parts.map((p) => `${p.label} ${kwh(p.kwh)}`).join(", ")}`}
              />
              <Legend
                columns={parts.length === 3 ? 3 : 2}
                items={parts.map((p) => ({ color: p.color, label: p.label, value: kwh(p.kwh) }))}
              />
            </>
          )}
          {(solar || battery) && avoided >= 0.05 && (
            <p className="rounded-control bg-bg px-3.5 py-3 text-sm text-ink-soft">
              {solar && battery
                ? "Le soleil et la batterie vous évitent"
                : solar
                  ? "Le soleil vous évite"
                  : "La batterie vous évite"}{" "}
              <strong className="text-ink">≈ {eur(avoided)}</strong> d&apos;achats demain.
            </p>
          )}
        </section>
        {windows}
        {why}
        <Card
          title="Le détail heure par heure"
          description="Pour aller plus loin : touchez une heure."
        >
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
            {past.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full bg-ink" />
                Consommation prévue
                <span className="w-5 border-t-2 border-dashed border-ink" />à venir
              </span>
            )}
            {mixed && <span>Heures écoulées : mesuré ; à venir, plus clair : prévu</span>}
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
                    color: tone(h, "bg-solar"),
                    label: "Couverte sur place",
                  },
                  { value: h.importKwh, color: tone(h, "bg-grid"), label: "Achetée" },
                ],
                previous: solar ? h.solarKwh : undefined,
              };
            })}
            line={[
              ...(priced
                ? // Le coût d'un kWh de plus ne concerne que les heures à venir.
                  [
                    {
                      values: list.map((h) => (h.measured ? null : h.kwhCostEur)),
                      color: COST_LINE,
                    },
                  ]
                : []),
              ...(past.length > 0
                ? [
                    // Ce qui était prévu pour les heures écoulées…
                    {
                      values: list.map((h) => h.estimated?.loadKwh ?? null),
                      color: FORECAST_LINE,
                      barScale: true,
                    },
                    // … puis la prévision, en pointillés, reliée à la dernière heure écoulée.
                    {
                      values: list.map((h, i) =>
                        !h.measured
                          ? h.loadKwh
                          : list[i + 1] && !list[i + 1]?.measured
                            ? (h.estimated?.loadKwh ?? null)
                            : null,
                      ),
                      color: FORECAST_LINE,
                      barScale: true,
                      dashed: true,
                    },
                  ]
                : []),
            ]}
          />
          {past.length > 0 && (
            <p className="text-[13px] text-ink-soft tabular-nums">
              Depuis minuit : {kwh(sum((h) => h.loadKwh))} consommés pour{" "}
              {kwh(sum((h) => h.estimated?.loadKwh ?? 0))} prévus
              {solar &&
                ` · ${kwh(sum((h) => h.solarKwh))} produits pour ${kwh(sum((h) => h.estimated?.solarKwh ?? 0))} prévus`}
              .
            </p>
          )}
          <p className="text-[11px] text-muted tabular-nums" aria-live="polite">
            {focus ? detail(focus) : "Touchez une heure pour son détail."}
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="flex">{switcher}</div>
      <Card
        icon="sun"
        title="Aujourd'hui"
        description="Prévisions heure par heure, d'après vos habitudes, la météo et votre contrat."
      >
        <div className={tiles}>
          {solar && (
            <StatTile
              label={day.measured.hours > 0 ? "Production du jour" : "Production prévue"}
              value={kwh(day.solarKwh)}
              sub={
                day.measured.solarKwh > 0 ? `dont ${kwh(day.measured.solarKwh)} mesurés` : undefined
              }
              dot="bg-solar"
            />
          )}
          <StatTile
            label={day.measured.hours > 0 ? "Consommation du jour" : "Consommation prévue"}
            value={kwh(day.loadKwh)}
            sub={day.measured.hours > 0 ? `dont ${kwh(day.measured.loadKwh)} mesurés` : undefined}
          />
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
        {chart}
      </Card>
      {windows}
    </>
  );
}
