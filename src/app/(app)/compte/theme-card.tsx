"use client";

import { callAction } from "@/lib/action";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { THEME_LABELS, THEMES, type Theme } from "@/domain/theme";
import { setThemeAction } from "@/server/actions/theme";

const HINTS: Record<Theme, string> = {
  light: "Fond clair, le thème d'origine.",
  dark: "Fond sombre, plus reposant le soir.",
  auto: "Suit le réglage clair ou sombre de l'appareil.",
};

/** Apparence (T43) : appliquée aussitôt sur la page, enregistrée sur le compte. */
export function ThemeCard({ theme: saved }: { theme: Theme }) {
  const [theme, setTheme] = useState(saved);
  const [error, setError] = useState(false);
  const [, startTransition] = useTransition();

  const choose = (next: Theme) => {
    const previous = theme;
    setTheme(next);
    setError(false);
    document.documentElement.dataset.theme = next;
    startTransition(async () => {
      const res = await callAction(() => setThemeAction(next));
      if (!res.ok) {
        setTheme(previous);
        document.documentElement.dataset.theme = previous;
        setError(true);
      }
    });
  };

  return (
    <Card icon="sun" title="Apparence" description="Thème de l'interface, sur tous vos appareils.">
      <div className="flex flex-col gap-2">
        <div
          role="radiogroup"
          aria-label="Thème"
          className="flex w-fit gap-1 rounded-[10px] bg-chip p-[3px]"
        >
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              onClick={() => choose(t)}
              className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium whitespace-nowrap ${
                theme === t ? "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-soft"
              }`}
            >
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{HINTS[theme]}</p>
        {error && (
          <p role="alert" className="text-xs text-negative">
            Thème non enregistré. Réessayez.
          </p>
        )}
      </div>
    </Card>
  );
}
