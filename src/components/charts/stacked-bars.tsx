import { PeriodLink } from "@/components/period-transition";

// Barres verticales empilées en HTML (SPEC §2 : graphiques maison). Segments séparés de
// 2 px, extrémité arrondie, info-bulle native par barre. Une barre peut être un lien
// (sélection d'un mois). Une courbe peut se superposer aux barres, sur sa propre échelle.
// Comparaison à l'année précédente : barre claire accolée, les
// paires bien séparées ; au-delà de 20 barres (un mois en jours), barre claire plus large
// derrière la barre de l'année, une colonne par jour reste lisible.

export interface BarSegment {
  value: number;
  /** Classe de fond Tailwind (ex. `bg-grid`). */
  color: string;
  label: string;
}

export interface Bar {
  key: string;
  /** Libellé sous la barre (court). */
  label: string;
  /** Du bas vers le haut de la barre. */
  segments: BarSegment[];
  /** Texte de l'info-bulle. */
  title: string;
  href?: string;
  selected?: boolean;
  /** Valeur de comparaison (année précédente), en barre claire à gauche ; null : aucune. */
  previous?: number | null;
  /** Un repère tombe sur cette barre : petit point sous l'étiquette (texte dans `title`). */
  marked?: boolean;
}

/** Courbe superposée : une valeur par barre (null : pas de point, la courbe s'interrompt). */
export interface BarLine {
  values: (number | null)[];
  /** Couleur du trait (CSS). */
  color: string;
}

/** Tracés de la courbe en coordonnées 0–100, un par suite de valeurs connues. */
function linePaths(values: (number | null)[]): string[] {
  const max = Math.max(...values.map((v) => v ?? 0), 0);
  if (max <= 0) return [];
  const paths: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length > 1) paths.push(current.join(" "));
      current = [];
      return;
    }
    // Comme les barres : le maximum touche le haut du graphique (repère de l'échelle).
    current.push(`${((i + 0.5) / values.length) * 100},${100 - (v / max) * 100}`);
  });
  if (current.length > 1) paths.push(current.join(" "));
  return paths;
}

export function StackedBars({
  bars,
  height = 160,
  ariaLabel,
  line,
  previousColor = "bg-grid/25",
}: {
  bars: Bar[];
  height?: number;
  ariaLabel: string;
  line?: BarLine;
  /** Couleur des barres de comparaison (année précédente). */
  previousColor?: string;
}) {
  const max = Math.max(
    ...bars.map((b) =>
      Math.max(
        b.segments.reduce((a, s) => a + s.value, 0),
        b.previous ?? 0,
      ),
    ),
    0,
  );
  const anySelected = bars.some((b) => b.selected);
  const paired = bars.some((b) => b.previous !== undefined);
  const anyMarked = bars.some((b) => b.marked);
  const dense = bars.length > 20;
  // Paires accolées (1 px), séparées de 8 px ; sinon 3 px entre les barres.
  const column = paired && !dense ? "px-[4px]" : "px-[1.5px]";
  const toHeight = (value: number) => (max > 0 ? `${(value / max) * 100}%` : 0);
  return (
    <div className="flex flex-col gap-1.5" role="img" aria-label={ariaLabel}>
      {/* Colonnes de largeur égale (marge de 1,5 px de chaque côté plutôt qu'un gap) : le
          centre de chaque barre est exactement là où la courbe place son point. */}
      <div className="relative flex items-end border-b border-border" style={{ height }}>
        {bars.map((b) => {
          const total = b.segments.reduce((a, s) => a + s.value, 0);
          const visible = b.segments.filter((s) => s.value > 0);
          const stack = (
            <div className="flex h-full min-w-0 flex-1 flex-col-reverse gap-[2px]">
              {visible.map((s, i) => (
                <div
                  key={s.label}
                  className={`${s.color} ${i === visible.length - 1 ? "rounded-t-[4px]" : ""}`}
                  style={{ height: toHeight(s.value) }}
                />
              ))}
              {total === 0 && <div className="h-px" />}
            </div>
          );
          const opacity = anySelected && !b.selected ? 0.45 : 1;
          const previousBar = (className: string) => (
            <div
              className={`rounded-t-[4px] ${previousColor} ${className}`}
              style={{ height: b.previous ? toHeight(b.previous) : 0 }}
            />
          );
          const body =
            paired && dense ? (
              <div className="relative flex h-full items-end justify-center" style={{ opacity }}>
                {previousBar("absolute inset-x-0 bottom-0")}
                <div className="relative flex h-full w-[55%] items-end">{stack}</div>
              </div>
            ) : (
              <div className="flex h-full items-end gap-px" style={{ opacity }}>
                {paired && previousBar("min-w-0 flex-1")}
                {stack}
              </div>
            );
          return b.href ? (
            <PeriodLink
              key={b.key}
              href={b.href}
              title={b.title}
              aria-label={b.title}
              selected={b.selected}
              className={`h-full min-w-0 flex-1 rounded-t-[4px] ${column} hover:opacity-100 focus-visible:outline-2 focus-visible:outline-ink`}
            >
              {body}
            </PeriodLink>
          ) : (
            <div key={b.key} title={b.title} className={`h-full min-w-0 flex-1 ${column}`}>
              {body}
            </div>
          );
        })}
        {line && (
          <svg
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 size-full overflow-visible"
          >
            {linePaths(line.values).map((points) => (
              <g key={points}>
                {/* Liseré couleur de fond : la courbe se détache des barres. */}
                <polyline
                  points={points}
                  fill="none"
                  stroke="var(--color-surface)"
                  strokeWidth={4}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <polyline
                  points={points}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          </svg>
        )}
      </div>
      <div className="flex" aria-hidden>
        {bars.map((b) => (
          <span
            key={b.key}
            className="flex min-w-0 flex-1 flex-col items-center gap-[3px] px-[1.5px]"
          >
            <span
              className={`w-full text-center text-[10px] tabular-nums ${
                // Beaucoup de barres (un mois en jours) : libellés espacés, qui peuvent déborder
                // sur les colonnes voisines vides ; sinon tronqués à leur colonne.
                bars.length > 20 ? "overflow-visible whitespace-nowrap" : "truncate"
              } ${b.selected ? "font-semibold text-ink" : "text-subtle"}`}
            >
              {b.label}
            </span>
            {anyMarked && (
              <span className={`size-[5px] rounded-full ${b.marked ? "bg-ink" : ""}`} />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
