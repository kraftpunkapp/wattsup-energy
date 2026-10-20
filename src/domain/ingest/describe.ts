import { formatNumber } from "@/lib/format";
import { metricLabel } from "./metrics";

// Avertissements et erreurs du journal des envois (SPEC §6.1), en phrases pour l'interface.
// Le journal garde les codes bruts ; une entrée inconnue (version future) est ignorée.

export interface WarningLine {
  /** info : comportement normal ; warning : à vérifier côté Home Assistant. */
  tone: "info" | "warning";
  text: string;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const list = (labels: string[]) =>
  labels.length < 2 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} et ${labels.at(-1)}`;

const duration = (hours: number) => (hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} jours`);

/** Phrases par compteur, regroupées quand plusieurs compteurs partagent le même message. */
const PER_METRIC: Record<string, { tone: WarningLine["tone"]; text: (w: Raw) => string }> = {
  baseline: { tone: "info", text: () => "premier relevé, comptage à partir du prochain envoi" },
  gap_too_long: {
    tone: "info",
    text: (w) => `${duration(Number(w.hours))} sans relevé, période non comptée`,
  },
  reset: { tone: "warning", text: () => "compteur remis à zéro, nouveau point de départ" },
  out_of_order: { tone: "warning", text: () => "relevé plus ancien que le précédent, ignoré" },
  invalid_value: { tone: "warning", text: () => "valeur invalide, ignorée" },
  implausible: {
    tone: "warning",
    text: (w) =>
      `${formatNumber(Number(w.kwhPerHour), 1)} kWh en une heure, valeur inhabituelle à vérifier`,
  },
};

type Raw = Record<string, unknown>;

/**
 * @param categoryNames nom affiché de chaque poste, par slug (un poste supprimé depuis garde
 *   son slug).
 */
export function describeWarnings(
  warnings: readonly unknown[],
  categoryNames: Record<string, string>,
): WarningLine[] {
  const label = (metric: string) => metricLabel(metric, categoryNames);

  const groups = new Map<string, { tone: WarningLine["tone"]; text: string; labels: string[] }>();
  const lines: (WarningLine | string)[] = [];
  for (const w of warnings) {
    if (typeof w !== "object" || w === null || !("code" in w)) continue;
    const raw = w as Raw;
    const rule = PER_METRIC[String(raw.code)];
    if (rule && typeof raw.metric === "string") {
      const text = rule.text(raw);
      const key = `${rule.tone}|${text}`;
      const group = groups.get(key);
      if (group) group.labels.push(label(raw.metric));
      else {
        groups.set(key, { tone: rule.tone, text, labels: [label(raw.metric)] });
        lines.push(key);
      }
    } else if (raw.code === "unknown_category") {
      lines.push({
        tone: "warning",
        text: `Poste « ${String(raw.key)} » inconnu : créez-le dans Postes ou corrigez son slug dans Home Assistant.`,
      });
    } else if (raw.code === "ignored_block") {
      lines.push({
        tone: "info",
        text: `Bloc « ${String(raw.key)} » non exploité par cette version.`,
      });
    } else if (raw.code === "fuel_event") {
      const n = (v: unknown) =>
        typeof v === "number" ? v.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "?";
      const wood = raw.unit === "stères";
      const what = wood ? `${n(raw.qty)} stère de bois` : `${n(raw.qty)} sac de granulés`;
      lines.push({
        tone: "info",
        text: `Décompte depuis Home Assistant : ${what} ; stock restant ${n(raw.stock)} ${String(raw.unit)}.`,
      });
    } else if (raw.code === "backfill") {
      lines.push(...backfillLines(raw));
    } else if (raw.code === "no_energy_data") {
      lines.push({
        tone: "warning",
        text: "Aucune valeur d'énergie reçue : dans l'automatisation WattsUp de Home Assistant, choisissez au moins le capteur « Import réseau » et vérifiez qu'il a une valeur.",
      });
    } else if (raw.code === "missing_grid_import") {
      lines.push({
        tone: "warning",
        text: "Pas d'import réseau dans cet envoi : l'électricité achetée et son coût ne sont pas comptés. Choisissez le capteur « Import réseau » dans l'automatisation WattsUp et vérifiez qu'il a une valeur.",
      });
    }
  }
  return lines.map((l) => {
    if (typeof l !== "string") return l;
    const g = groups.get(l) as { tone: WarningLine["tone"]; text: string; labels: string[] };
    return { tone: g.tone, text: `${capitalize(list(g.labels))} : ${g.text}.` };
  });
}

/** Résumé d'un envoi d'historique : valeurs ajoutées, déjà présentes, rejetées. */
function backfillLines(raw: Raw): WarningLine[] {
  const n = (v: unknown) => (typeof v === "number" ? v : 0);
  const r = (typeof raw.rejected === "object" && raw.rejected !== null ? raw.rejected : {}) as Raw;
  const rejected = n(r.implausible) + n(r.negative) + n(r.outOfRange) + n(r.unknownCategory);
  const fr = (v: number) => formatNumber(v);
  const lines: WarningLine[] = [
    {
      tone: "info",
      text: `Historique : ${fr(n(raw.inserted))} valeurs ajoutées, ${fr(n(raw.existing))} déjà présentes (conservées).`,
    },
  ];
  if (rejected > 0) {
    const parts = [
      n(r.implausible) && `${fr(n(r.implausible))} invraisemblables`,
      n(r.negative) && `${fr(n(r.negative))} négatives`,
      n(r.outOfRange) && `${fr(n(r.outOfRange))} hors période`,
      n(r.unknownCategory) && `${fr(n(r.unknownCategory))} d'un poste inconnu`,
    ].filter(Boolean);
    lines.push({
      tone: "warning",
      text: `${fr(rejected)} valeurs rejetées : ${parts.join(", ")}.`,
    });
  }
  if (raw.quotaReached === true) {
    lines.push({
      tone: "warning",
      text: "Quota de valeurs du foyer atteint : la fin de l'envoi n'est pas enregistrée.",
    });
  }
  return lines;
}

/** Erreur d'un envoi refusé : la liste des champs invalides est stockée en JSON. */
export function describeLogError(error: string): string[] {
  try {
    const parsed: unknown = JSON.parse(error);
    if (Array.isArray(parsed)) {
      return parsed.map((e: { path?: string; message?: string }) =>
        e.path ? `${e.path} : ${e.message}` : String(e.message),
      );
    }
  } catch {
    // message simple
  }
  return [error];
}
