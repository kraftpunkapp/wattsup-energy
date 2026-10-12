import { addDays, weekdayOf } from "@/lib/time";
import { toSegments } from "./base-hphc";
import type { Pricer, Share } from "./pricer";
import type { CustomContract, CustomRule } from "./types";

// Contrats sur mesure (SPEC §7.1) : règles ordonnées { jours, plages, prix, mois }, la
// première qui couvre une minute donnée s'applique. Une table des 10 080 minutes de la
// semaine (minute → indice de règle) est précalculée par mois (une seule si aucune règle
// n'a de mois). Avec `dayStartHour` = 6 (T56), le jour et le mois d'une heure avant 6 h
// sont ceux de la veille ; les plages restent en heure locale.

const DAY_MIN = 1440;
const WEEK_MIN = 7 * DAY_MIN;
const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MONTH_NAMES = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

const hm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const appliesIn = (rule: CustomRule, month: number) =>
  rule.months === undefined || rule.months.includes(month);

/** Table minute de la semaine → indice de règle, pour un mois (0 : règles sans mois). */
function buildTable(rules: readonly CustomRule[], month: number): Int16Array {
  const table = new Int16Array(WEEK_MIN).fill(-1);
  rules.forEach((rule, index) => {
    if (month !== 0 && !appliesIn(rule, month)) return;
    for (const [from, to] of toSegments(rule.ranges)) {
      for (const day of rule.days) {
        const base = (day - 1) * DAY_MIN;
        for (let m = from; m < to; m++) if (table[base + m] === -1) table[base + m] = index;
      }
    }
  });
  return table;
}

const usesMonths = (rules: readonly CustomRule[]) => rules.some((r) => r.months !== undefined);

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
    if (rule.months !== undefined) {
      if (rule.months.length === 0) errors.push(`aucun mois dans « ${rule.label} »`);
      for (const month of rule.months) {
        if (!Number.isInteger(month) || month < 1 || month > 12) {
          errors.push(`mois invalide dans « ${rule.label} » : ${month}`);
        }
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

  for (const month of usesMonths(rules) ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [0]) {
    const gap = buildTable(rules, month).indexOf(-1);
    if (gap !== -1) {
      const when = `${DAY_NAMES[Math.floor(gap / DAY_MIN)]} à ${hm(gap % DAY_MIN)}`;
      errors.push(
        month === 0
          ? `aucune règle ne couvre ${when}`
          : `aucune règle ne couvre ${MONTH_NAMES[month - 1]} le ${when}`,
      );
      break;
    }
  }
  return errors;
}

export function customPricer(contract: CustomContract): Pricer {
  const errors = validateCustomRules(contract.rules);
  if (errors.length > 0) throw new Error(`contrat invalide : ${errors.join(" ; ")}`);
  const monthly = usesMonths(contract.rules);
  const dayStart = contract.dayStartHour ?? 0;
  const tables = new Map<number, Int16Array>();
  const tableFor = (month: number) => {
    const key = monthly ? month : 0;
    let table = tables.get(key);
    if (!table) tables.set(key, (table = buildTable(contract.rules, key)));
    return table;
  };

  // Une année horaire ne compte que 168 heures de semaine distinctes par mois : parts
  // mémorisées.
  const memo = new Map<number, Share[]>();

  /** Parts par règle sur [start, start + length) minutes de la semaine, pour un mois. */
  const shares = (month: number, start: number, length: number): Share[] => {
    const memoKey = ((monthly ? month : 0) * WEEK_MIN + start) * 2048 + length;
    const known = memo.get(memoKey);
    if (known) return known;
    const table = tableFor(month);
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
    hour: (local) => {
      // Avant l'heure de début de journée : jour et mois de la veille, à l'heure réelle.
      const before = local.hour < dayStart;
      const date = before ? addDays(local.date, -1) : local.date;
      const weekday = before ? (local.weekday === 1 ? 7 : local.weekday - 1) : local.weekday;
      return shares(
        Number(date.slice(5, 7)),
        (weekday - 1) * DAY_MIN + local.hour * 60 + local.minute,
        60,
      );
    },
    // Un total journalier (même ventilé HP/HC par HA) ne dit pas à quelle règle il
    // revient : réparti au prorata des minutes, exact seulement si une règle couvre tout.
    day: (date) => {
      const result = shares(Number(date.slice(5, 7)), (weekdayOf(date) - 1) * DAY_MIN, DAY_MIN);
      return { shares: result, approximated: result.length > 1 };
    },
  };
}
