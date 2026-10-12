import { Badge } from "@/components/ui";
import { formatPercent } from "@/lib/format";

/**
 * Part des heures (envoi horaire) ou des jours (envoi quotidien) reçus sur la période. En
 * dessous de 95 %, la pastille passe en alerte : les montants sont sous-estimés.
 */
export function CoverageBadge({
  ratio,
  granularity,
}: {
  ratio: number;
  granularity: "hourly" | "daily";
}) {
  const unit = granularity === "hourly" ? "heures" : "jours";
  const complete = ratio >= 0.95;
  return (
    <span
      className="whitespace-nowrap"
      title={
        complete
          ? `${formatPercent(ratio)} des ${unit} de la période ont été reçues.`
          : `Seules ${formatPercent(ratio)} des ${unit} de la période ont été reçues : les totaux et les coûts sont sous-estimés.`
      }
    >
      <Badge tone={complete ? "neutral" : "warning"}>
        Données {granularity === "hourly" ? "horaires" : "quotidiennes"} {formatPercent(ratio)}
      </Badge>
    </span>
  );
}
