"use client";

import { Fragment, useState } from "react";
import { Icon } from "@/components/ui";
import { monthLabel } from "@/domain/overview";
import { formatEurFromCents, formatNumber, formatPercent } from "@/lib/format";
import type { MonthCost, MonthFigures } from "@/server/queries/overview";

// Détail mois par mois de l'année (SPEC §9, Vue d'ensemble) : carte repliée par défaut.
// Électricité soutirée (dont HP / HC si le contrat en a), coût, production et économie
// solaire estimée ; chaque mois se déplie sur le même mois de l'année précédente. Les
// écarts ne sont donnés que pour un mois terminé (un mois entamé contre un mois entier
// tromperait).

const eur = (cents: number) => formatEurFromCents(cents, 0);
const kwh = (v: number) => formatNumber(v);

/** Écart à N-1, coloré selon le sens qui est une bonne nouvelle. */
function Delta({
  now,
  before,
  lowerIsBetter,
}: {
  now: number;
  before: number;
  lowerIsBetter: boolean;
}) {
  if (before <= 0) return null;
  const d = now / before - 1;
  const good = lowerIsBetter ? d <= 0 : d >= 0;
  return (
    <span className={`block text-[11px] ${good ? "text-positive" : "text-negative"}`}>
      {d >= 0 ? "+" : "−"}
      {formatPercent(Math.abs(d))}
    </span>
  );
}

type Column = {
  id: string;
  label: string;
  value: (f: MonthFigures) => number | null;
  format: (v: number) => string;
  /** Écart à N-1 : null pour ne pas en afficher ; sinon sens favorable. */
  lowerIsBetter: boolean | null;
};

export function MonthlyTable({
  months,
  year,
  currentMonth,
  solar,
  priced,
}: {
  months: MonthCost[];
  year: string;
  /** Mois en cours « AAAA-MM » : pas d'écart à N-1 pour lui. */
  currentMonth: string;
  /** Profil solaire : colonnes production et économie. */
  solar: boolean;
  /** Faux : aucun contrat pour chiffrer l'électricité, pas de colonne de coût (T63). */
  priced: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const hasHpHc = months.some(
    (m) => m.hpKwh + m.hcKwh > 0 || (m.previous && m.previous.hpKwh + m.previous.hcKwh > 0),
  );
  const columns: Column[] = [
    ...(hasHpHc
      ? [
          {
            id: "hp",
            label: "HP",
            value: (f: MonthFigures) => f.hpKwh,
            format: kwh,
            lowerIsBetter: null,
          },
          {
            id: "hc",
            label: "HC",
            value: (f: MonthFigures) => f.hcKwh,
            format: kwh,
            lowerIsBetter: null,
          },
        ]
      : []),
    { id: "kwh", label: "Soutiré", value: (f) => f.kwh, format: kwh, lowerIsBetter: true },
    ...(priced
      ? [
          {
            id: "cost",
            label: "Coût",
            value: (f: MonthFigures) => f.energyCents + f.subscriptionCents,
            format: eur,
            lowerIsBetter: true,
          },
        ]
      : []),
    ...(solar
      ? [
          {
            id: "solar",
            label: "Production",
            value: (f: MonthFigures) => f.solarKwh,
            format: kwh,
            lowerIsBetter: false,
          },
          {
            id: "saving",
            label: "Économie",
            value: (f: MonthFigures) => f.solarSavingCents,
            format: eur,
            lowerIsBetter: null,
          },
        ]
      : []),
  ];
  const groups = [
    { label: "Électricité (kWh)", span: hasHpHc ? 3 : 1 },
    ...(priced ? [{ label: "Budget (€)", span: 1 }] : []),
    ...(solar ? [{ label: "Solaire", span: 2 }] : []),
  ];

  const total = (pick: (f: MonthFigures) => number | null, list: (MonthFigures | null)[]) => {
    const values = list.map((f) => (f ? pick(f) : null)).filter((v): v is number => v !== null);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };
  const complete = months.filter((m) => m.key < currentMonth);
  const yearComplete = complete.length === months.length && months.length === 12;

  const cell = "px-3 py-2.5 text-right tabular-nums whitespace-nowrap";
  const sticky = "sticky left-0 z-[1] bg-surface";

  return (
    <details className="group rounded-card border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-[15px] font-semibold">Détail mois par mois · {year}</h2>
          <span className="text-xs text-muted text-pretty">
            Électricité, budget{solar ? " et solaire" : ""} de chaque mois, comparés au même mois de{" "}
            {Number(year) - 1}. Touchez un mois pour voir l&apos;année précédente.
          </span>
        </span>
        <span className="mt-0.5 flex-none text-muted transition-transform group-open:rotate-90">
          <Icon name="chevron" size={16} />
        </span>
      </summary>

      <div className="overflow-x-auto border-t border-track">
        <table className="w-full min-w-[560px] border-collapse text-[13px]">
          <thead>
            <tr className="text-[11px] text-muted">
              <th rowSpan={2} className={`${sticky} px-3 py-2 text-left font-medium`}>
                Mois
              </th>
              {groups.map((g) => (
                <th
                  key={g.label}
                  colSpan={g.span}
                  className="border-l border-track px-3 pt-2 text-right font-medium"
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-track text-[11px] text-subtle">
              {columns.map((c, i) => (
                <th
                  key={c.id}
                  className={`px-3 pb-2 text-right font-normal ${
                    i === 0 || c.id === "cost" || c.id === "solar" ? "border-l border-track" : ""
                  }`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const isOpen = open.has(m.key);
              const done = m.key < currentMonth;
              return (
                <Fragment key={m.key}>
                  <tr className="border-b border-track">
                    <th scope="row" className={`${sticky} px-3 py-2.5 text-left font-medium`}>
                      {m.previous ? (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => toggle(m.key)}
                          className="flex items-center gap-1.5 capitalize"
                        >
                          <span
                            className={`text-subtle transition-transform ${isOpen ? "rotate-90" : ""}`}
                          >
                            <Icon name="chevron" size={12} />
                          </span>
                          {monthLabel(m.key).split(" ")[0]}
                        </button>
                      ) : (
                        <span className="pl-[18px] capitalize">
                          {monthLabel(m.key).split(" ")[0]}
                        </span>
                      )}
                    </th>
                    {columns.map((c, i) => {
                      const v = c.value(m);
                      const before = m.previous ? c.value(m.previous) : null;
                      return (
                        <td
                          key={c.id}
                          className={`${cell} ${i === 0 || c.id === "cost" || c.id === "solar" ? "border-l border-track" : ""}`}
                        >
                          <span className="font-medium">{v === null ? "—" : c.format(v)}</span>
                          {done && c.lowerIsBetter !== null && v !== null && before !== null && (
                            <Delta now={v} before={before} lowerIsBetter={c.lowerIsBetter} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen && m.previous && (
                    <tr className="border-b border-track bg-bg/60 text-subtle">
                      <th
                        scope="row"
                        className={`${sticky} bg-bg px-3 py-2 pl-8 text-left text-xs font-normal`}
                      >
                        {Number(year) - 1}
                      </th>
                      {columns.map((c, i) => {
                        const v = c.value(m.previous as MonthFigures);
                        return (
                          <td
                            key={c.id}
                            className={`${cell} py-2 text-xs ${i === 0 || c.id === "cost" || c.id === "solar" ? "border-l border-track" : ""}`}
                          >
                            {v === null ? "—" : c.format(v)}
                          </td>
                        );
                      })}
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" className={`${sticky} px-3 py-2.5 text-left`}>
                {year}
              </th>
              {columns.map((c, i) => {
                const v = total(c.value, months);
                const before = total(
                  c.value,
                  months.map((m) => m.previous),
                );
                return (
                  <td
                    key={c.id}
                    className={`${cell} ${i === 0 || c.id === "cost" || c.id === "solar" ? "border-l border-track" : ""}`}
                  >
                    {v === null ? "—" : c.format(v)}
                    {yearComplete && c.lowerIsBetter !== null && v !== null && before !== null && (
                      <Delta now={v} before={before} lowerIsBetter={c.lowerIsBetter} />
                    )}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      {solar && (
        <p className="border-t border-track px-4 py-3 text-[11px] text-subtle text-pretty sm:px-5">
          Économie solaire estimée au prix moyen du kWh soutiré chaque mois ; le calcul exact, heure
          par heure, est dans Rentabilité.
        </p>
      )}
    </details>
  );
}
