"use client";

import type { ReactNode } from "react";
import { segmented } from "./segmented-styles";

/**
 * Sélecteur à segments (€ / kWh, doux / moyen / rigoureux…). Un seul choix à la fois,
 * annoncé comme un groupe de boutons à bascule ; l'option choisie est aussi mise en
 * évidence par son fond, pas par la couleur seule.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className={segmented.group}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={segmented.item(o.value === value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
