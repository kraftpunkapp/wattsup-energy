import type { ReactNode } from "react";

export interface LegendItem {
  /** Classe de fond Tailwind du repère (ex. `bg-solar`). */
  color: string;
  label: ReactNode;
  /** Valeur affichée sous le libellé (ex. « 352 kWh »). */
  value?: ReactNode;
}

/** Légende : repère de couleur, libellé et valeur facultative, en liste (lue par les lecteurs d'écran). */
export function Legend({ items, columns }: { items: LegendItem[]; columns?: 2 | 3 | 4 }) {
  const grid = columns ? `grid gap-3 ${COLS[columns]}` : "flex flex-wrap gap-x-5 gap-y-2";
  return (
    <ul className={`${grid} text-[13px] text-ink-soft`}>
      {items.map((it, i) => (
        <li key={i} className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={`size-2.5 flex-none rounded-[3px] ${it.color}`} />
            {it.label}
          </span>
          {it.value !== undefined && (
            <strong className="text-[15px] font-semibold text-ink tabular-nums">{it.value}</strong>
          )}
        </li>
      ))}
    </ul>
  );
}

const COLS = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" } as const;
