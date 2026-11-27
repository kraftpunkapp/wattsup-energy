// Heures creuses d'un contrat (T80) : réforme de 2025-2027, horaires propres à chaque foyer.

import type { Contract } from "./types";

/** Vrai si le foyer doit vérifier ses horaires : grille en cours HP/HC. */
export const needsOffPeakCheck = (current: Contract | null): boolean => current?.kind === "hphc";
