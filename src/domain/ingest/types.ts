// Métriques d'énergie stockées dans energy_interval (SPEC §5).
export type CoreMetric =
  | "grid_import"
  | "grid_export"
  | "solar_production"
  | "battery_charge"
  | "battery_charge_grid"
  | "battery_discharge";

export type CategoryMetric = `category:${string}`;

export type Metric = CoreMetric | CategoryMetric;

export type IngestWarning =
  | { code: "baseline"; metric: Metric }
  | { code: "reset"; metric: Metric }
  | { code: "out_of_order"; metric: Metric }
  | { code: "invalid_value"; metric: Metric }
  | { code: "gap_too_long"; metric: Metric; hours: number }
  | { code: "implausible"; metric: Metric; kwhPerHour: number }
  | { code: "unknown_category"; key: string }
  /** Bloc reçu mais pas encore exploité par cette version (ex. `fuel` avant T23). */
  | { code: "ignored_block"; key: string }
  /** Payload valide mais sans aucune valeur d'énergie exploitable (capteurs mal choisis ?). */
  | { code: "no_energy_data" }
  /** D'autres compteurs envoyés, mais pas l'import réseau (capteur oublié ou sans valeur). */
  | { code: "missing_grid_import" };

export interface HourlyInterval {
  metric: Metric;
  /** Début de l'heure, aligné sur une heure UTC pleine. */
  start: Date;
  kwh: number;
}
