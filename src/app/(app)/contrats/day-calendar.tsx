"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

// Calendrier d'une saison, jour par jour (Tempo, jours de sobriété Zen Flex) : une case par
// jour, colorée selon sa valeur ; toucher un jour ouvre sa correction. Un jour entouré a été
// corrigé à la main.

export interface CalendarCell<V extends string> {
  date: string;
  value: V | null;
  /** Provenance de la valeur (libellé dans `sources`) ; null : inconnue. */
  source: string | null;
}

const monthLabel = (ym: string) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "short" });
export const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

export function DayCalendar<V extends string>({
  title,
  summary,
  days,
  options,
  unknownLabel,
  sources,
  footer,
  onChoose,
}: {
  title: string;
  summary: ReactNode;
  days: CalendarCell<V>[];
  /** Valeurs possibles, dans l'ordre des boutons de correction. */
  options: { value: V; label: string; swatch: string }[];
  /** Libellé d'un jour sans valeur (« couleur inconnue »). */
  unknownLabel: string;
  sources: Record<string, string>;
  footer: ReactNode;
  onChoose: (date: string, value: V | null) => Promise<unknown>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<CalendarCell<V> | null>(null);
  const [pending, startTransition] = useTransition();
  const option = (v: V | null) => options.find((o) => o.value === v);
  const describe = (d: CalendarCell<V>) =>
    `${option(d.value)?.label ?? unknownLabel}${d.source ? ` (${sources[d.source] ?? d.source})` : ""}`;

  const months = new Map<string, CalendarCell<V>[]>();
  for (const d of days) {
    const list = months.get(d.date.slice(0, 7)) ?? [];
    list.push(d);
    months.set(d.date.slice(0, 7), list);
  }

  const choose = (value: V | null) => {
    if (!selected) return;
    startTransition(async () => {
      await onChoose(selected.date, value);
      setSelected(null);
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-[11px] text-subtle tabular-nums">{summary}</span>
      </div>
      {/* Pas de 24 px entre les cases : cible tactile suffisante sans agrandir les carrés. */}
      <div className="flex flex-col gap-2.5">
        {[...months].map(([ym, list]) => (
          <div key={ym} className="flex items-start gap-2">
            <span className="w-9 flex-none text-[11px] leading-[14px] text-subtle">
              {monthLabel(ym)}
            </span>
            <div className="flex flex-wrap gap-2.5">
              {list.map((d) => {
                const swatch = option(d.value)?.swatch;
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setSelected(d)}
                    title={`${dayLabel(d.date)} : ${describe(d)}`}
                    aria-label={`${dayLabel(d.date)}, ${option(d.value)?.label ?? unknownLabel}`}
                    className={`size-3.5 rounded-[3px] ${swatch ?? "border border-dashed border-dash"} ${
                      d.source === "manual" ? "ring-2 ring-ink ring-offset-1" : ""
                    } ${selected?.date === d.date ? "outline-2 outline-pellet" : ""}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {selected ? (
        <div className="flex flex-col gap-2 rounded-[10px] bg-bg p-3">
          <span className="text-[13px]">
            <span className="font-medium">{dayLabel(selected.date)}</span>
            <span className="text-muted"> · {describe(selected)}</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={pending}
                onClick={() => choose(o.value)}
                className="flex items-center gap-1.5 rounded-[8px] border border-border-strong bg-surface px-2.5 py-1.5 text-xs hover:bg-bg"
              >
                <span className={`size-2.5 rounded-[3px] ${o.swatch}`} />
                {o.label}
              </button>
            ))}
            {selected.source === "manual" && (
              <button
                type="button"
                disabled={pending}
                onClick={() => choose(null)}
                className="rounded-[8px] px-2.5 py-1.5 text-xs text-negative hover:bg-surface"
              >
                Retirer la correction
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded-[8px] px-2.5 py-1.5 text-xs text-muted hover:bg-surface"
            >
              Fermer
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-subtle">{footer}</p>
      )}
    </section>
  );
}
