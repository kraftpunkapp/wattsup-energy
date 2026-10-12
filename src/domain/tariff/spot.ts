import { zonedInstant } from "@/lib/time";
import type { Pricer, Share } from "./pricer";
import type { PricingContext, SpotContract, SpotFormula } from "./types";

// Contrat au prix spot (T58, SPEC §7.12) : chaque heure est facturée au prix du marché
// EPEX France du lendemain (fourni par le serveur, en €/MWh), plus acheminement, accise,
// plafond éventuel et frais du fournisseur, TVA comprise. Une heure sans prix connu prend le
// prix moyen de la période et est comptée ; un total journalier prend la moyenne du jour.

const WINTER = new Set([11, 12, 1, 2, 3]);

/** Prix TTC du kWh pour un prix spot (€/MWh) et un mois (1–12). */
export function spotKwhPrice(f: SpotFormula, spotEurMwh: number, month: number): number {
  const winter = WINTER.has(month);
  const network = winter ? f.network.winter : f.network.summer;
  const cap = f.cap ? (winter ? f.cap.winter : f.cap.summer) : Infinity;
  return (Math.min(spotEurMwh / 1000 + network + f.excise, cap) + f.fees) * (1 + f.vat);
}

export function spotPricer(contract: SpotContract, ctx: PricingContext): Pricer {
  let assumed = 0;
  const priceOf = (start: Date): number | undefined => ctx.spotPrice?.(start);
  const share = (spot: number, month: number): Share[] => [
    { key: "spot", price: spotKwhPrice(contract.formula, spot, month), fraction: 1 },
  ];

  return {
    hour: (local, start) => {
      let spot = priceOf(start);
      if (spot === undefined) {
        assumed += 1;
        spot = ctx.spotFallback ?? 0;
      }
      return share(spot, Number(local.date.slice(5, 7)));
    },
    // Sans le détail horaire, la consommation du jour est supposée répartie uniformément.
    day: (date) => {
      const known: number[] = [];
      for (let h = 0; h < 24; h++) {
        const p = priceOf(zonedInstant(date, h, ctx.timezone));
        if (p !== undefined) known.push(p);
      }
      const spot =
        known.length > 0
          ? known.reduce((a, b) => a + b, 0) / known.length
          : (ctx.spotFallback ?? 0);
      if (known.length === 0) assumed += 24;
      return { shares: share(spot, Number(date.slice(5, 7))), approximated: true };
    },
    assumedHours: () => assumed,
  };
}
