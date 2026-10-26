import { formatEurFromCents, formatPercent } from "@/lib/format";
import { localParts } from "@/lib/time";
import { hourLabel } from "./summary";

// Notification du soir « Créneaux de demain » (T74, SPEC §7.14), facultative : envoyée
// seulement si un créneau de demain fait gagner au moins 0,30 € ou est couvert à 80 % par le
// solaire ; une seule par soir. Pur.

const MIN_SAVING_EUR = 0.3;
const MIN_SOLAR_SHARE = 0.8;

export interface TomorrowNoticeSettings {
  enabled: boolean;
  email: boolean;
}

/** Réglage enregistré (JSONB) ; désactivé par défaut. */
export function parseTomorrowNotice(raw: unknown): TomorrowNoticeSettings {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return { enabled: r.enabled === true, email: r.email === true };
}

interface Planned {
  appliance: { name: string };
  window: {
    start: Date;
    end: Date;
    costEur: number;
    nowCostEur: number;
    solarShare: number;
  } | null;
}

const eur = (v: number) => formatEurFromCents(v * 100, 2);

export function tomorrowNotice(
  windows: readonly Planned[],
  tomorrow: string,
  timezone: string,
): { title: string; body: string } | null {
  const useful = windows
    .flatMap((p) => {
      const w = p.window;
      if (!w || localParts(w.start, timezone).date !== tomorrow) return [];
      const saving = w.nowCostEur - w.costEur;
      if (saving < MIN_SAVING_EUR && w.solarShare < MIN_SOLAR_SHARE) return [];
      return [{ name: p.appliance.name, w, saving }];
    })
    .sort((a, b) => a.w.start.getTime() - b.w.start.getTime());
  if (useful.length === 0) return null;
  const hours = (w: Planned["window"] & object, sep: string) =>
    `${hourLabel(w.start, timezone)}${sep}${hourLabel(w.end, timezone)}`;
  const first = useful[0] as (typeof useful)[number];
  const title =
    useful.length === 1
      ? `Demain, ${first.name.toLowerCase()} de ${hours(first.w, " à ")}`
      : `Demain, ${useful.length} créneaux avantageux`;
  const body = useful
    .map(({ name, w, saving }) => {
      const parts = [
        w.solarShare >= MIN_SOLAR_SHARE ? `${formatPercent(w.solarShare)} solaire` : null,
        saving >= MIN_SAVING_EUR ? `${eur(saving)} de moins que tout de suite` : null,
      ].filter(Boolean);
      return `${name} ${hours(w, " – ")} : ${parts.join(", ")}.`;
    })
    .join(" ");
  return { title, body };
}
