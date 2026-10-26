import { localParts } from "@/lib/time";

// Bilan de chaque jour prévu et libellés des créneaux (T72, SPEC §7.14). Pur.

export interface DaySummary {
  date: string;
  solarKwh: number;
  loadKwh: number;
  importKwh: number;
  exportKwh: number;
  /** Électricité achetée, au prix de chaque heure (hors abonnement) ; null sans contrat. */
  costEur: number | null;
}

export function daySummaries(
  hours: readonly {
    start: Date;
    solarKwh: number;
    loadKwh: number;
    importKwh: number;
    exportKwh: number;
  }[],
  prices: readonly number[] | null,
  timezone: string,
): DaySummary[] {
  const days = new Map<string, DaySummary>();
  hours.forEach((h, i) => {
    const date = localParts(h.start, timezone).date;
    const d = days.get(date) ?? {
      date,
      solarKwh: 0,
      loadKwh: 0,
      importKwh: 0,
      exportKwh: 0,
      costEur: prices ? 0 : null,
    };
    d.solarKwh += h.solarKwh;
    d.loadKwh += h.loadKwh;
    d.importKwh += h.importKwh;
    d.exportKwh += h.exportKwh;
    if (d.costEur !== null) d.costEur += h.importKwh * (prices?.[i] ?? 0);
    days.set(date, d);
  });
  return [...days.values()];
}

/** « 13 h », « 21 h 30 ». */
export const hourLabel = (instant: Date, timezone: string) => {
  const p = localParts(instant, timezone);
  return p.minute === 0 ? `${p.hour} h` : `${p.hour} h ${String(p.minute).padStart(2, "0")}`;
};

/** « demain, 13 h – 15 h » : jour du départ relatif à aujourd'hui. */
export function windowLabel(start: Date, end: Date, today: string, timezone: string): string {
  const date = localParts(start, timezone).date;
  const day =
    date === today
      ? "aujourd'hui"
      : new Date(`${date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime() ===
          86_400_000
        ? "demain"
        : new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
          });
  return `${day}, ${hourLabel(start, timezone)} – ${hourLabel(end, timezone)}`;
}
