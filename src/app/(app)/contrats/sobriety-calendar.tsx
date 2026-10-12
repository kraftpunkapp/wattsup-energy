"use client";

import { setSobrietyAction } from "@/server/actions/contracts";
import { DayCalendar } from "./day-calendar";

// Jours de sobriété EDF Zen Flex (T57) : importés avec le catalogue des offres du marché,
// corrigeables par le foyer.

export interface SobrietyDay {
  date: string;
  sobriety: boolean;
  source: "manual" | "calendar" | null;
}

type Value = "sobriety" | "normal";

const OPTIONS: { value: Value; label: string; swatch: string }[] = [
  { value: "sobriety", label: "Jour de sobriété", swatch: "bg-eheat" },
  { value: "normal", label: "Jour normal", swatch: "bg-track" },
];
const SOURCES = { manual: "corrigé à la main", calendar: "calendrier Zen Flex" };

export function SobrietyCalendar({ season, days }: { season: string; days: SobrietyDay[] }) {
  const count = days.filter((d) => d.sobriety).length;
  return (
    <DayCalendar
      title={`Jours de sobriété Zen Flex · saison ${season.replace("-", "–")}`}
      summary={`${count} jour${count > 1 ? "s" : ""} (20 au plus, d'octobre à avril)`}
      days={days.map((d) => ({
        date: d.date,
        value: d.sobriety ? "sobriety" : "normal",
        source: d.source,
      }))}
      options={OPTIONS}
      unknownLabel="jour normal"
      sources={SOURCES}
      footer="Jours repris du calendrier de comparateur-abonnements-electricite.fr, mis à jour quand la source l'est : un jour annoncé par EDF la veille peut manquer. Touchez un jour pour le corriger ; un jour entouré a été corrigé à la main."
      onChoose={(date, value) =>
        setSobrietyAction(date, value === null ? null : value === "sobriety")
      }
    />
  );
}
