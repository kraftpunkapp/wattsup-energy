import { plausibleKwhPerHour } from "./hourly";

// Libellés des compteurs et règle des valeurs suspectes, partagés par le journal des
// envois et l'onglet Données. Pur.

/** Compteurs du foyer, en minuscules (insérés dans une phrase). */
export const CORE_METRIC_LABELS: Record<string, string> = {
  grid_import: "import réseau",
  grid_export: "export réseau",
  solar_production: "production solaire",
  battery_charge: "charge batterie",
  battery_charge_grid: "charge batterie depuis le réseau",
  battery_discharge: "décharge batterie",
};

/** Niveau de la batterie (T78) : relevés en %, consultables dans l'onglet Données, hors kWh. */
export const BATTERY_LEVEL = "battery_level";

/**
 * Nom d'un compteur : libellé du compteur, ou nom du poste (son slug entre guillemets s'il
 * a été supprimé). `capitalized` pour un titre ou une liste.
 */
export function metricLabel(
  metric: string,
  categoryNames: Record<string, string>,
  capitalized = false,
): string {
  const label = metric.startsWith("category:")
    ? (categoryNames[metric.slice("category:".length)] ?? `« ${metric.slice("category:".length)} »`)
    : metric === BATTERY_LEVEL
      ? "niveau de la batterie (%)"
      : (CORE_METRIC_LABELS[metric] ?? metric);
  return capitalized ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

/** Plafond d'une valeur selon sa durée : seuil horaire du compteur, × 24 pour un jour. */
export const valueCap = (metric: string, granularity: "hour" | "day") =>
  plausibleKwhPerHour(metric) * (granularity === "day" ? 24 : 1);

/** Valeur suspecte : au-delà du seuil de plausibilité du compteur. */
export const isSuspect = (metric: string, granularity: "hour" | "day", kwh: number) =>
  kwh > valueCap(metric, granularity);
