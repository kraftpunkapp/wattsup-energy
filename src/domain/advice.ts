import { offPeakRangesAt } from "./tariff/off-peak";
import { formatNumber } from "@/lib/format";
import type { Contract, TempoColor, TimeRange } from "./tariff/types";

// « Quand consommer » (SPEC §9, Vue d'ensemble, T48) : les heures où l'électricité est la
// moins chère pour ce foyer. Surplus solaire habituel (profil des 30 derniers jours), heures
// creuses du contrat en cours, couleur Tempo du lendemain. Seulement ce qui s'applique. Pur.

/** Export moyen vers le réseau par heure locale (kWh), sur les jours récents. */
export interface HourProfile {
  hour: number;
  exportKwh: number;
}

/** kWh par heure au-delà desquels une heure compte comme « en surplus ». */
const SURPLUS_KWH = 0.2;

/** Plus longue suite d'heures en surplus (fin exclue) et son export moyen ; null sans surplus. */
export function surplusWindow(
  profile: readonly HourProfile[],
  threshold = SURPLUS_KWH,
): { from: number; to: number; kwhPerHour: number } | null {
  const byHour = new Map(profile.map((p) => [p.hour, p.exportKwh]));
  let best: { from: number; to: number } | null = null;
  let start: number | null = null;
  for (let h = 0; h <= 24; h++) {
    const on = h < 24 && (byHour.get(h) ?? 0) >= threshold;
    if (on && start === null) start = h;
    if (!on && start !== null) {
      if (!best || h - start > best.to - best.from) best = { from: start, to: h };
      start = null;
    }
  }
  if (!best) return null;
  let sum = 0;
  for (let h = best.from; h < best.to; h++) sum += byHour.get(h) ?? 0;
  return { ...best, kwhPerHour: Math.round((sum / (best.to - best.from)) * 100) / 100 };
}

/** « 22:00 » → « 22 h » ; « 06:30 » → « 6 h 30 ». */
export const formatHm = (hm: string) => {
  const [h = "0", m = "00"] = hm.split(":");
  return m === "00" ? `${Number(h)} h` : `${Number(h)} h ${m}`;
};

const ranges = (list: readonly TimeRange[]) =>
  list.map((r) => `${formatHm(r.from)} – ${formatHm(r.to)}`).join(" et ");

const price = (eurKwh: number) => `${formatNumber(eurKwh, 3)} €`;

export interface Advice {
  id: "surplus" | "off_peak" | "tempo_tomorrow";
  tone: "positive" | "info" | "warning";
  title: string;
  text: string;
}

export function consumptionAdvice(input: {
  /** Jour local du foyer (AAAA-MM-JJ) : la saison des heures creuses. */
  date: string;
  surplus: ReturnType<typeof surplusWindow>;
  contract: Contract | null;
  /** Contrat Tempo seulement : couleur du lendemain, null si pas encore publiée. */
  tomorrow: { color: TempoColor | null } | null;
}): Advice[] {
  const out: Advice[] = [];
  const c = input.contract;
  if (c?.kind === "tempo" && input.tomorrow) {
    const color = input.tomorrow.color;
    if (color === null) {
      out.push({
        id: "tempo_tomorrow",
        tone: "info",
        title: "Couleur de demain pas encore publiée",
        text: "RTE l'annonce vers 11 h : revenez plus tard avant de programmer les gros appareils.",
      });
    } else if (color === "rouge") {
      const ratio = c.prices.rouge.hp / c.prices.bleu.hp;
      out.push({
        id: "tempo_tomorrow",
        tone: "warning",
        title: "Demain, jour rouge",
        text: `De 6 h à 22 h, le kWh coûte ${price(c.prices.rouge.hp)} (${formatNumber(ratio, 1)} fois un jour bleu) : décalez ce qui peut l'être à la nuit ou au jour suivant.`,
      });
    } else if (color === "blanc") {
      out.push({
        id: "tempo_tomorrow",
        tone: "info",
        title: "Demain, jour blanc",
        text: `Heures pleines à ${price(c.prices.blanc.hp)} le kWh, un peu plus qu'un jour bleu (${price(c.prices.bleu.hp)}).`,
      });
    } else {
      out.push({
        id: "tempo_tomorrow",
        tone: "positive",
        title: "Demain, jour bleu",
        text: `Le kWh le moins cher de Tempo (${price(c.prices.bleu.hp)} en heures pleines) : un bon jour pour les gros consommateurs.`,
      });
    }
  }
  if (input.surplus) {
    const s = input.surplus;
    out.push({
      id: "surplus",
      tone: "positive",
      title: `Entre ${s.from} h et ${s.to} h : votre surplus solaire`,
      text: `Vous envoyez en moyenne ${formatNumber(s.kwhPerHour, 1)} kWh par heure au réseau à ces heures (30 derniers jours) : lancez-y lave-linge, lave-vaisselle, chauffe-eau ou recharge.`,
    });
  }
  if (c?.kind === "hphc" && c.hcRanges.length > 0) {
    out.push({
      id: "off_peak",
      tone: "info",
      title: `Heures creuses : ${ranges(offPeakRangesAt(c, input.date))}`,
      text: `Programmez ce qui peut attendre (lave-vaisselle, chauffe-eau, recharge) sur ces plages : le kWh y coûte ${price(c.prices.hc)} au lieu de ${price(c.prices.hp)}.`,
    });
  } else if (c?.kind === "tempo") {
    out.push({
      id: "off_peak",
      tone: "info",
      title: "Heures creuses : 22 h – 6 h, tous les jours",
      text: `Même un jour rouge, la nuit reste bon marché (${price(c.prices.rouge.hc)} le kWh) : programmez-y ce qui peut attendre.`,
    });
  }
  return out;
}
