import type { LocalParts } from "@/lib/time";
import type { Slot } from "./types";

/** Une part de l'énergie d'un intervalle, facturée à un prix donné. */
export interface Share {
  /** Clé de ventilation (bySlot). */
  key: string;
  price: number;
  /** Fraction de l'intervalle, la somme des parts vaut 1. */
  fraction: number;
}

/** Stratégie de prix d'un type de contrat. */
export interface Pricer {
  hour(local: LocalParts, start: Date): Share[];
  day(date: string, slot: Slot | null): { shares: Share[]; approximated: boolean };
  /** Nombre de jours dont un paramètre a dû être supposé (couleur Tempo inconnue). */
  assumedDays?(): number;
  /** Nombre d'heures dont le prix a dû être supposé (prix spot inconnu). */
  assumedHours?(): number;
}
