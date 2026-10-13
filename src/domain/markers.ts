import { eachDay } from "@/lib/time";
import { monthLabel, nextMonth } from "./overview";

// Repères (SPEC §7.10) : notes datées posées sur la frise du temps pour expliquer une hausse
// ou une baisse de consommation. Saisis par l'utilisateur, ou déduits des données
// (début d'un contrat, mise en service d'un équipement). Pur.

export const MARKER_KINDS = ["equipment", "maintenance", "absence", "other"] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

/** Longueur maximale du texte d'un repère. */
export const MARKER_TEXT_MAX = 140;

export interface Marker {
  /** null : repère automatique (non modifiable). */
  id: string | null;
  kind: MarkerKind | "contract" | "install";
  text: string;
  /** Jours locaux « AAAA-MM-JJ » ; fin incluse, null pour un seul jour. */
  startDate: string;
  endDate: string | null;
}

const lastDay = (m: Marker) => m.endDate ?? m.startDate;
const byDate = (a: Marker, b: Marker) => a.startDate.localeCompare(b.startDate);

/** Repères qui touchent les jours [from, to), du plus ancien au plus récent. */
export function markersBetween(markers: readonly Marker[], from: string, to: string): Marker[] {
  return markers.filter((m) => m.startDate < to && lastDay(m) >= from).sort(byDate);
}

/** Repères par mois « AAAA-MM » couvert (un repère sur plusieurs mois les marque tous). */
export function markedMonths(markers: readonly Marker[]): Map<string, Marker[]> {
  const months = new Map<string, Marker[]>();
  for (const m of [...markers].sort(byDate)) {
    const last = lastDay(m).slice(0, 7);
    for (let month = m.startDate.slice(0, 7); month <= last; month = nextMonth(month)) {
      months.set(month, [...(months.get(month) ?? []), m]);
    }
  }
  return new Map([...months.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Repères par jour « AAAA-MM-JJ » de la période [from, to) (vue mois). */
export function markedDays(
  markers: readonly Marker[],
  from: string,
  to: string,
): Map<string, Marker[]> {
  const days = new Map<string, Marker[]>();
  for (const d of eachDay(from, to)) {
    const list = markers.filter((m) => m.startDate <= d && d <= lastDay(m)).sort(byDate);
    if (list.length > 0) days.set(d, list);
  }
  return days;
}

const day = (date: string) => Number(date.slice(8, 10));
const monthName = (date: string) => monthLabel(date.slice(0, 7)).split(" ")[0] ?? "";

/** « 3 octobre 2026 », « du 3 au 10 octobre 2026 », « du 28 septembre au 4 octobre 2026 ». */
export function markerDates(m: Marker): string {
  const end = lastDay(m);
  if (end === m.startDate) return `${day(m.startDate)} ${monthLabel(m.startDate.slice(0, 7))}`;
  const endLabel = `${day(end)} ${monthLabel(end.slice(0, 7))}`;
  if (m.startDate.slice(0, 7) === end.slice(0, 7)) return `du ${day(m.startDate)} au ${endLabel}`;
  const startLabel =
    m.startDate.slice(0, 4) === end.slice(0, 4)
      ? `${day(m.startDate)} ${monthName(m.startDate)}`
      : `${day(m.startDate)} ${monthLabel(m.startDate.slice(0, 7))}`;
  return `du ${startLabel} au ${endLabel}`;
}

/** Repères déduits des données : début de chaque contrat souscrit, mise en service. */
export function autoMarkers(
  contracts: readonly { name: string; status: string; startDate: string | null }[],
  equipment: readonly { label: string; installedOn: string }[],
): Marker[] {
  return [
    ...contracts.flatMap((c) =>
      c.status === "subscribed" && c.startDate
        ? [
            {
              id: null,
              kind: "contract" as const,
              text: `Nouveau contrat : ${c.name}`,
              startDate: c.startDate,
              endDate: null,
            },
          ]
        : [],
    ),
    ...equipment.map((e) => ({
      id: null,
      kind: "install" as const,
      text: `Mise en service : ${e.label}`,
      startDate: e.installedOn,
      endDate: null,
    })),
  ];
}
