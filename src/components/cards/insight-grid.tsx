"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { MONTHS_PANEL } from "@/components/cards/insight-ids";
import { Icon, type IconName } from "@/components/ui";

// « Ce qu'il faut retenir » : quatre tuiles côte à côte (une par sujet), chacune avec son
// pictogramme teinté, sa phrase et, quand les données le permettent, un petit graphique. Toucher
// une tuile déplie son détail : en pleine largeur sous la rangée quand les tuiles sont côte à
// côte, et juste sous la tuile quand elles sont empilées (téléphone), pour ne pas renvoyer le
// détail tout en bas de la page.

const OpenContext = createContext<{
  open: string | null;
  toggle: (id: string) => void;
  details: Record<string, ReactNode>;
} | null>(null);

/** Teintes des pastilles de pictogramme (jamais une couleur de sens réutilisée à autre chose). */
const TONE = {
  grid: "bg-grid text-on-grid",
  pellet: "bg-pellet text-on-fill",
  solar: "bg-solar text-on-hc",
  hc: "bg-hc text-on-hc",
  neutral: "bg-bg text-ink",
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
    <OpenContext.Provider value={{ open, toggle, details }}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
          <div className="flex flex-col gap-0.5">
            <h2 id="retenir" className="text-base font-bold">
              {title}
            </h2>
            <p className="text-sm text-muted">{subtitle}</p>
          </div>
          {monthsLabel && (
            <button
              type="button"
              aria-expanded={open === MONTHS_PANEL}
              aria-controls={`insight-${MONTHS_PANEL}`}
              onClick={() => toggle(MONTHS_PANEL)}
              className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-semibold"
            >
              {monthsLabel}
              <span className={`transition-transform ${open === MONTHS_PANEL ? "rotate-90" : ""}`}>
                <Icon name="arrowRight" size={16} />
              </span>
            </button>
          )}
        </div>
        {/* Détail mois par mois : sous le lien qui l'ouvre, à toutes les largeurs. */}
        {open === MONTHS_PANEL && details[MONTHS_PANEL] && (
          <div id={`insight-${MONTHS_PANEL}`}>{details[MONTHS_PANEL]}</div>
        )}
        <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {children}
        </div>
        {/* Tuiles côte à côte : détail sous la rangée (sur téléphone, il suit sa tuile). */}
        {open && open !== MONTHS_PANEL && details[open] && (
          <div className="max-sm:hidden">{details[open]}</div>
        )}
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
  chip,
  visual,
  actions,
}: {
  id: string;
  icon: IconName;
  tone: InsightTone;
  title: string;
  headline: ReactNode;
  detail?: ReactNode;
  /** Écart ou statut en puce, sous le titre. */
  chip?: ReactNode;
  visual?: ReactNode;
  actions?: ReactNode;
}) {
  const ctx = useContext(OpenContext);
  const open = ctx?.open === id;
  return (
    <div className="relative flex flex-col gap-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`insight-${id}`}
        onClick={() => ctx?.toggle(id)}
        className={`flex w-full flex-1 cursor-pointer flex-col gap-3 rounded-[18px] border bg-surface p-5 text-left ${
          open ? "border-accent" : "border-border"
        }`}
      >
        <span className="flex items-center gap-2.5 pr-12">
          <span
            aria-hidden
            className={`flex size-8 flex-none items-center justify-center rounded-[9px] ${TONE[tone]}`}
          >
            <Icon name={icon} size={17} />
          </span>
          <span className="wu-label min-w-0 text-pretty">{title}</span>
        </span>
        <span className="text-base leading-snug font-bold text-pretty">{headline}</span>
        {chip && <span className="flex">{chip}</span>}
        {detail && <span className="text-sm text-muted text-pretty">{detail}</span>}
        {visual}
        <span className="mt-auto inline-flex items-center gap-1 pt-1 text-[13px] font-semibold">
          {open ? "Masquer le détail" : "Voir le détail"}
          <span aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`}>
            →
          </span>
        </span>
      </button>
      {actions && <div className="absolute top-2.5 right-2.5">{actions}</div>}
      {/* Téléphone : le détail s'ouvre juste sous sa tuile. */}
      {open && ctx?.details[id] && (
        <div id={`insight-${id}`} className="sm:hidden">
          {ctx.details[id]}
        </div>
      )}
    </div>
  );
}
