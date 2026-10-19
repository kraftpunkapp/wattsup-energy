"use client";

import { useEffect, useState } from "react";
import { StackedBars } from "@/components/charts/stacked-bars";
import { Toggle } from "@/components/ui";
import { monthLabel, shortMonth } from "@/domain/overview";
import { formatKwh } from "@/lib/format";
import type { SolarPoint } from "@/server/queries/overview";

// Graphique de la carte « Production et ensoleillement » : barres de production, courbe
// d'ensoleillement superposée (échelle propre, valeur du haut de chaque côté), et en
// option la production de l'année précédente en barre claire (la courbe s'efface alors,
// pour rester lisible). Le choix est mémorisé sur l'appareil. En vue mois, toucher un jour
// affiche ses chiffres sous le graphique (T61).

const COMPARE_KEY = "wattsup:solar-compare";
/** Couleur de la courbe d'ensoleillement (et de son repère dans la tuile). */
const SUNSHINE = "var(--color-ink-soft)";

const fmtHours = (h: number) =>
  `${h.toLocaleString("fr-FR", { maximumFractionDigits: h < 10 ? 1 : 0 })} h`;
const kwh = (v: number) => formatKwh(v, v < 10 ? 1 : 0);

export function SolarChart({
  points,
  byMonth,
  periodLabel,
  year,
  noLocation,
}: {
  points: SolarPoint[];
  /** Vue année (un point par mois) ; sinon un point par jour. */
  byMonth: boolean;
  periodLabel: string;
  year: string;
  noLocation: boolean;
}) {
  const [compare, setCompare] = useState(false);
  // Jour touché ; une autre période (autre premier jour) efface la sélection.
  const [picked, setPicked] = useState<{ first: string; key: string } | null>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem(COMPARE_KEY) === "1") setCompare(true);
    } catch {
      // stockage indisponible : sans comparaison
    }
  }, []);
  const toggle = () => {
    setCompare(!compare);
    try {
      localStorage.setItem(COMPARE_KEY, compare ? "0" : "1");
    } catch {
      // choix non mémorisé
    }
  };

  const previousYear = String(Number(year) - 1);
  const hasPrevious = points.some((p) => p.previousKwh !== null);
  const comparing = compare && hasPrevious;
  const showSun = !noLocation && !comparing;
  const label = (key: string, i: number) =>
    byMonth ? shortMonth(key) : i % 7 === 0 ? String(Number(key.slice(8))) : "";
  const pointTitle = (key: string) =>
    byMonth
      ? monthLabel(key)
      : new Date(`${key}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const maxKwh = Math.max(
    ...points.map((p) => Math.max(p.kwh, comparing ? (p.previousKwh ?? 0) : 0)),
    0,
  );
  const maxSunshine = Math.max(...points.map((p) => p.sunshineHours ?? 0), 0);
  const first = points[0]?.key ?? "";
  const focus =
    !byMonth && picked?.first === first ? points.find((p) => p.key === picked.key) : undefined;
  const detail = (p: SolarPoint) =>
    `${pointTitle(p.key)} : ${kwh(p.kwh)}${
      comparing && p.previousKwh !== null
        ? ` · ${previousYear} : ${kwh(p.previousKwh)}`
        : !noLocation && p.sunshineHours !== null
          ? ` · ${fmtHours(p.sunshineHours)} de soleil`
          : ""
    }`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        {hasPrevious && (
          <Toggle label={`Comparer à ${previousYear}`} checked={compare} onChange={toggle} />
        )}
        <span className="flex gap-3">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-solar" />
            {comparing ? year : "Production (kWh)"}
          </span>
          {comparing && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-[2px] bg-solar/35" />
              {previousYear}
            </span>
          )}
          {showSun && (
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: SUNSHINE }} />
              Ensoleillement (h)
            </span>
          )}
        </span>
      </div>
      {/* Valeur du haut de chaque échelle : barres à gauche, courbe à droite. */}
      <div className="-mb-1 flex justify-between text-[10px] text-subtle tabular-nums">
        <span>{kwh(maxKwh)}</span>
        {showSun && maxSunshine > 0 && <span>{fmtHours(maxSunshine)}</span>}
      </div>
      <StackedBars
        height={140}
        ariaLabel={`Production solaire ${byMonth ? "par mois" : "par jour"}, ${periodLabel}`}
        previousColor="bg-solar/35"
        bars={points.map((p, i) => ({
          key: p.key,
          label: label(p.key, i),
          title: detail(p),
          ...(byMonth
            ? {}
            : {
                selected: p.key === focus?.key,
                onSelect: () => setPicked(p.key === focus?.key ? null : { first, key: p.key }),
              }),
          segments: [{ value: p.kwh, color: "bg-solar", label: "Production" }],
          previous: comparing ? p.previousKwh : undefined,
        }))}
        line={showSun ? { values: points.map((p) => p.sunshineHours), color: SUNSHINE } : undefined}
      />
      {!byMonth && (
        <p className="text-[11px] text-muted tabular-nums" aria-live="polite">
          {focus ? detail(focus) : "Touchez un jour pour son détail."}
        </p>
      )}
    </div>
  );
}
