import { currentContract } from "@/domain/tariff/timeline";
import type { ContractWithPeriods } from "@/server/contracts";
import type { ContractItem } from "./contracts-manager";

/** Contrats du foyer pour le gestionnaire (Contrats, bienvenue) : l'actuel est marqué. */
export function toContractItems(contracts: ContractWithPeriods[], today: string): ContractItem[] {
  const current = currentContract(contracts, today);
  return contracts.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    status: c.status,
    startDate: c.startDate,
    endDate: c.endDate,
    isCurrent: c.id === current?.id,
    payment: c.payment,
    periods: c.periods,
  }));
}
