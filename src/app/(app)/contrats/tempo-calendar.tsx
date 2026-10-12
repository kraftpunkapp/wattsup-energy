"use client";

import type { TempoColor } from "@/domain/tariff/types";
import { setTempoColorAction } from "@/server/actions/contracts";
import { DayCalendar } from "./day-calendar";

export interface CalendarDay {
  date: string;
  color: TempoColor | null;
  source: "manual" | "ha" | "community" | "seed" | null;
}

const OPTIONS: { value: TempoColor; label: string; swatch: string }[] = [
  { value: "bleu", label: "Bleu", swatch: "bg-grid" },
  { value: "blanc", label: "Blanc", swatch: "bg-tempo-white" },
  { value: "rouge", label: "Rouge", swatch: "bg-eheat" },
];
const SOURCES = {
  manual: "corrigée à la main",
  ha: "envoyée par Home Assistant",
  community: "calendrier Tempo",
  seed: "historique intégré",
};
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

export function TempoCalendar({ season, days }: { season: string; days: CalendarDay[] }) {
  const counts = { bleu: 0, blanc: 0, rouge: 0 };
  for (const d of days) if (d.color) counts[d.color] += 1;
  return (
    <DayCalendar
      title={`Calendrier Tempo · saison ${season.replace("-", "–")}`}
      summary={`${plural(counts.blanc, "blanc")} · ${plural(counts.rouge, "rouge")} (sur 43 et 22)`}
      days={days.map((d) => ({ date: d.date, value: d.color, source: d.source }))}
      options={OPTIONS}
      unknownLabel="couleur inconnue"
      sources={SOURCES}
      footer="Couleurs récupérées automatiquement chaque jour. Touchez un jour pour le corriger ; un jour entouré a été corrigé à la main."
      onChoose={(date, color) => setTempoColorAction(date, color)}
    />
  );
}
