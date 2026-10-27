// Aujourd'hui sur la page Prévisions (SPEC §7.14) : les heures déjà écoulées et reçues de
// Home Assistant affichent le mesuré, avec ce qui était estimé (la prévision figée la veille
// au soir, à défaut l'estimation du modèle) ; les autres (heure en cours, à venir, pas encore
// reçue) restent prévues. Pur.

const HOUR_MS = 3_600_000;

export interface MeasuredHour {
  solarKwh: number;
  importKwh: number;
  exportKwh: number;
  /** Consommation du foyer = import + production + décharge − export − charge. */
  loadKwh: number;
}

export interface Estimate {
  solarKwh: number;
  loadKwh: number;
}

export function withActuals<
  H extends {
    start: Date;
    solarKwh: number;
    loadKwh: number;
    importKwh: number;
    exportKwh: number;
  },
>(
  hours: readonly H[],
  actuals: ReadonlyMap<number, MeasuredHour>,
  nowMs: number,
  /** Prévision figée la veille au soir (T73), par début d'heure. */
  frozen: ReadonlyMap<number, Estimate> = new Map(),
): (H & { measured: boolean; estimated: Estimate | null })[] {
  return hours.map((h) => {
    const t = h.start.getTime();
    const actual = t + HOUR_MS <= nowMs ? actuals.get(t) : undefined;
    if (!actual) return { ...h, measured: false, estimated: null };
    const estimated = frozen.get(t) ?? { solarKwh: h.solarKwh, loadKwh: h.loadKwh };
    return { ...h, ...actual, measured: true, estimated };
  });
}
