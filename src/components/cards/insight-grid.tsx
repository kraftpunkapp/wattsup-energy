"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { MONTHS_PANEL } from "@/components/cards/insight-ids";
import { Icon, type IconName } from "@/components/ui";

// « Ce qu'il faut retenir » : quatre tuiles côte à côte (une par sujet), chacune avec son
// pictogramme teinté, sa phrase et, quand les données le permettent, un petit graphique. Toucher
// une tuile déplie son détail en pleine largeur sous la rangée.

const OpenContext = createContext<{ open: string | null; toggle: (id: string) => void } | null>(
  null,
);

/** Teintes des pastilles de pictogramme (jamais une couleur de sens réutilisée à autre chose). */
const TONE = {
  grid: "bg-grid/12 text-grid",
  pellet: "bg-pellet/15 text-pellet",
  solar: "bg-solar/15 text-solar-ink",
  neutral: "bg-track text-ink-soft",
} as const;

export type InsightTone = keyof typeof TONE;

export function InsightGrid({
  title,
  subtitle,
  monthsLabel,
  details,
  children,
}: {
  title: string;
  subtitle: string;
  /** Texte du lien qui ouvre le détail mois par mois (absent : pas de lien). */
  monthsLabel?: string;
  /** Détail de chaque tuile, par identifiant (et du panneau mois par mois). */
  details: Record<string, ReactNode>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen(open === id ? null : id);
  return (
    <OpenContext.Provider value={{ open, toggle }}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <div className="flex flex-col gap-0.5">
            <h2 id="retenir" className="text-[22px] font-bold">
              {title}
            </h2>
            <p className="text-[15px] text-muted">{subtitle}</p>
          </div>
          {monthsLabel && (
            <button
              type="button"
              aria-expanded={open === MONTHS_PANEL}
              aria-controls={`insight-${MONTHS_PANEL}`}
              onClick={() => toggle(MONTHS_PANEL)}
              className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-[15px] font-semibold"
            >
              {monthsLabel}
              <span className={`transition-transform ${open === MONTHS_PANEL ? "rotate-90" : ""}`}>
                <Icon name="arrowRight" size={16} />
              </span>
            </button>
          )}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] items-stretch gap-4">
          {children}
        </div>
        {open && details[open] && <div id={`insight-${open}`}>{details[open]}</div>}
      </div>
    </OpenContext.Provider>
  );
}

export function InsightTile({
  id,
  icon,
  tone,
  title,
  headline,
  detail,
  visual,
  actions,
}: {
  id: string;
  icon: IconName;
  tone: InsightTone;
  title: string;
  headline: ReactNode;
  detail?: ReactNode;
  visual?: ReactNode;
  actions?: ReactNode;
}) {
  const ctx = useContext(OpenContext);
  const open = ctx?.open === id;
  return (
    <div className="relative flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`insight-${id}`}
        onClick={() => ctx?.toggle(id)}
        className={`flex w-full cursor-pointer flex-col gap-3 rounded-[18px] border bg-surface p-5 text-left ${
          open ? "border-accent" : "border-border"
        }`}
      >
        <span className="flex items-center gap-2.5 pr-12 text-sm text-ink-soft">
          <span
            aria-hidden
            className={`flex size-8 flex-none items-center justify-center rounded-[9px] ${TONE[tone]}`}
          >
            <Icon name={icon} size={17} />
          </span>
          {title}
        </span>
        <span className="text-lg leading-snug font-bold text-pretty">{headline}</span>
        {detail && <span className="text-sm text-muted text-pretty">{detail}</span>}
        {visual}
        <span className="mt-auto inline-flex items-center gap-1 pt-1 text-[13px] font-semibold">
          {open ? "Masquer le détail" : "Voir le détail"}
          <span className={`transition-transform ${open ? "rotate-90" : ""}`}>
            <Icon name="chevron" size={14} />
          </span>
        </span>
      </button>
      {actions && <div className="absolute top-2.5 right-2.5">{actions}</div>}
    </div>
  );
}
