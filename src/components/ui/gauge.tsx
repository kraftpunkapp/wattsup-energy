export interface GaugePart {
  value: number;
  /** Classe de fond Tailwind (ex. `bg-grid`). */
  color: string;
}

/**
 * Jauge : une barre découpée en parts proportionnelles, ou un remplissage simple.
 * `label` est l'alternative textuelle : elle dit les valeurs, la couleur ne suffit pas.
 */
export function Gauge({
  parts,
  label,
  height = 18,
}: {
  parts: GaugePart[];
  label: string;
  height?: number;
}) {
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div role="img" aria-label={label} className="flex gap-[3px]" style={{ height }}>
      {shown.map((p, i) => (
        <div
          key={i}
          className={`wu-grow-x ${p.color} ${
            i === 0 ? "rounded-l-[6px]" : "rounded-l-[2px]"
          } ${i === shown.length - 1 ? "rounded-r-[6px]" : "rounded-r-[2px]"}`}
          style={{ flex: `${p.value} 1 0` }}
        />
      ))}
    </div>
  );
}
