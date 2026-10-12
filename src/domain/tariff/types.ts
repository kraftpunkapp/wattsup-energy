// Contrats et entrées du moteur tarifaire (SPEC §7.1). Prix TTC en €/kWh,
// abonnement TTC en €/an.

export type Slot = "hp" | "hc";

/** Plage horaire locale "HH:MM"–"HH:MM", fin exclue ; peut passer minuit. */
export interface TimeRange {
  from: string;
  to: string;
}

export interface BaseContract {
  kind: "base";
  subscriptionEurYear: number;
  priceEurKwh: number;
}

export interface HphcContract {
  kind: "hphc";
  subscriptionEurYear: number;
  prices: Record<Slot, number>;
  hcRanges: TimeRange[];
}

export type TempoColor = "bleu" | "blanc" | "rouge";

/** Tempo : 6 prix (couleur × créneau). Heures creuses fixes de 22 h à 6 h. */
export interface TempoContract {
  kind: "tempo";
  subscriptionEurYear: number;
  prices: Record<TempoColor, Record<Slot, number>>;
}

/** Règle d'un contrat sur mesure : jours ISO (1 = lundi … 7 = dimanche) et plages. */
export interface CustomRule {
  /** Libellé unique, utilisé comme clé de ventilation (ex. « Week-end »). */
  label: string;
  days: number[];
  ranges: TimeRange[];
  price: number;
  /** Mois (1 = janvier … 12) où la règle s'applique (T56, saisons) ; absent : toute l'année. */
  months?: number[];
  /**
   * Règle des seuls jours de sobriété EDF Zen Flex (T57) : prioritaire ces jours-là,
   * ignorée les autres jours (qui doivent être couverts par les autres règles).
   */
  onlySobrietyDays?: true;
}

/** Contrat sur mesure : la première règle qui couvre une minute s'applique. */
export interface CustomContract {
  kind: "custom";
  subscriptionEurYear: number;
  rules: CustomRule[];
  /**
   * Heure où commence la journée pour les jours et les mois des règles (T56) : avec 6, une
   * heure avant 6 h compte pour la veille (nuit du dimanche au lundi en week-end, saison de
   * la veille). Absent ou 0 : minuit.
   */
  dayStartHour?: 0 | 6;
}

export type Contract = BaseContract | HphcContract | TempoContract | CustomContract;

export type PriceableInterval =
  | { granularity: "hour"; start: Date; kwh: number }
  | { granularity: "day"; date: string; slot: Slot | null; kwh: number };

export interface PricingContext {
  timezone: string;
  /** Période d'abonnement, jours locaux [from, to). */
  period: { from: string; to: string };
  /** Couleur d'un jour Tempo (AAAA-MM-JJ) ; undefined si inconnue. Requis pour Tempo. */
  tempoColor?: (day: string) => TempoColor | undefined;
  /** Jour de sobriété EDF Zen Flex (AAAA-MM-JJ) ; absent : aucun (T57). */
  sobrietyDay?: (day: string) => boolean;
}

export interface MonthBreakdown {
  energyCents: number;
  subscriptionCents: number;
  kwh: number;
  /** kWh du mois par créneau (mêmes clés que `bySlot` : « hp », « hc », « blue_hp »…). */
  slotKwh: Record<string, number>;
}

export interface PricedResult {
  /** energyCents + subscriptionCents. */
  totalCents: number;
  /** Arrondi une seule fois sur la somme exacte : la somme des mois peut différer d'un centime. */
  energyCents: number;
  subscriptionCents: number;
  kwh: number;
  /** Clé AAAA-MM (mois local). */
  byMonth: Record<string, MonthBreakdown>;
  /** Clés : "base", "hp", "hc", puis les créneaux propres à chaque type de contrat. */
  bySlot: Record<string, { kwh: number; energyCents: number }>;
  /** kWh dont la ventilation a dû être supposée (total journalier sans créneau). */
  approximatedKwh: number;
  /** Jours Tempo de couleur inconnue, facturés en bleu. */
  assumedTempoDays: number;
}
