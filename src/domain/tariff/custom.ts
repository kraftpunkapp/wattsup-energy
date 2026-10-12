import { weekdayOf } from "@/lib/time";
import { toSegments } from "./base-hphc";
import type { Pricer, Share } from "./pricer";
import type { CustomContract, CustomRule } from "./types";

// Contrats sur mesure (SPEC §7.1) : règles ordonnées { jours, plages, prix }, la
// première qui couvre une minute donnée s'applique. Une table des 10 080 minutes de la
// semaine (minute → indice de règle) est précalculée une fois par contrat.

const DAY_MIN = 1440;
const WEEK_MIN = 7 * DAY_MIN;
const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

const hm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function buildTable(rules: readonly CustomRule[]): Int16Array {
  const table = new Int16Array(WEEK_MIN).fill(-1);
  rules.forEach((rule, index) => {
    for (const [from, to] of toSegments(rule.ranges)) {
      for (const day of rule.days) {
        const base = (day - 1) * DAY_MIN;
        for (let m = from; m < to; m++) if (table[base + m] === -1) table[base + m] = index;
      }
    }
  });
  return table;
}

/** Erreurs de validation en français ; tableau vide si le jeu de règles est utilisable. */
export function validateCustomRules(rules: readonly CustomRule[]): string[] {
  if (rules.length === 0) return ["au moins une règle est requise"];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.label)) errors.push(`libellé en double : ${rule.label}`);
    seen.add(rule.label);
    for (const day of rule.days) {
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        errors.push(`jour invalide dans « ${rule.label} » : ${day}`);
      }
    }
    if (!Number.isFinite(rule.price) || rule.price < 0) {
      errors.push(`prix invalide dans « ${rule.label} »`);
    }
    try {
      toSegments(rule.ranges);
    } catch (err) {
      errors.push(`plage invalide dans « ${rule.label} » : ${(err as Error).message}`);
    }
  }
  if (errors.length > 0) return errors;

  const gap = buildTable(rules).indexOf(-1);
  if (gap !== -1) {
    errors.push(
      `aucune règle ne couvre ${DAY_NAMES[Math.floor(gap / DAY_MIN)]} à ${hm(gap % DAY_MIN)}`,
    );
  }
  return errors;
}

export function customPricer(contract: CustomContract): Pricer {
  const errors = validateCustomRules(contract.rules);
  if (errors.length > 0) throw new Error(`contrat invalide : ${errors.join(" ; ")}`);
  const table = buildTable(contract.rules);

  // Une année horaire ne compte que 168 heures de semaine distinctes : parts mémorisées.
  const memo = new Map<number, Share[]>();

  /** Parts par règle sur [start, start + length) minutes de la semaine. */
  const shares = (start: number, length: number): Share[] => {
    const memoKey = start * 2048 + length;
    const known = memo.get(memoKey);
    if (known) return known;
    const counts = new Map<number, number>();
    for (let i = 0; i < length; i++) {
      const rule = table[(start + i) % WEEK_MIN] as number;
      counts.set(rule, (counts.get(rule) ?? 0) + 1);
    }
    const result = [...counts].map(([index, count]) => {
      const rule = contract.rules[index] as CustomRule;
      return { key: rule.label, price: rule.price, fraction: count / length };
    });
    memo.set(memoKey, result);
    return result;
  };

  return {
    hour: (local) => shares((local.weekday - 1) * DAY_MIN + local.hour * 60 + local.minute, 60),
    // Un total journalier (même ventilé HP/HC par HA) ne dit pas à quelle règle il
    // revient : réparti au prorata des minutes, exact seulement si une règle couvre tout.
    day: (date) => {
      const result = shares((weekdayOf(date) - 1) * DAY_MIN, DAY_MIN);
      return { shares: result, approximated: result.length > 1 };
    },
  };
}
