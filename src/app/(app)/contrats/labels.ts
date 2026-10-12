import type { Contract } from "@/domain/tariff/types";

// Module partagé (sans "use client") : importable par les composants serveur et client.
export const KIND_LABELS: Record<Contract["kind"], string> = {
  base: "Base",
  hphc: "HP/HC",
  tempo: "Tempo",
  custom: "Sur mesure",
  spot: "Prix spot",
};
