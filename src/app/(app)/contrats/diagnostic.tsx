import type { ReactNode } from "react";
import { ArrowLink, IconChip, type IconName } from "@/components/ui";
import { PAYMENT_NOTICE_GAP, type PaymentAnalysis } from "@/domain/tariff/payment";
import { formatEurFromCents, formatNumber, formatPercent } from "@/lib/format";
import type { ContractComparison } from "@/server/queries/contracts";
import type { ComparedRow } from "./comparison-card";

// Diagnostic du haut de page : trois constats lus d'un coup d'œil, chacun avec sa phrase.
// 1. où se place le contrat en cours parmi les offres comparées, 2. la mensualité si elle
// s'écarte du coût réel, 3. le levier de l'horaire pour un contrat à heures creuses.

type Ok = Extract<ContractComparison, { status: "ok" }>;

/** Écart sous lequel deux offres coûtent la même chose (un euro par an). */
const SAME_CENTS = 100;
const eur = (cents: number) => `${Math.round(cents / 100).toLocaleString("fr-FR")} €`;
const label = (r: ComparedRow) => (r.provider ? `${r.provider} ${r.name}` : r.name);

function Row({
  icon,
  title,
  last,
  aside,
  children,
}: {
  icon: IconName;
  title: string;
  last?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-wrap items-start gap-x-4 gap-y-2 py-5 sm:flex-nowrap ${last ? "" : "border-b border-track"}`}
    >
      <IconChip icon={icon} size="lg" />
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
        <h2 className="text-[15px] font-bold text-balance">{title}</h2>
        {children}
      </div>
      {aside && <div className="basis-full pl-14 sm:basis-auto sm:pl-0">{aside}</div>}
    </div>
  );
}

const Text = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-ink-soft text-pretty">{children}</p>
);

export function ContractsDiagnostic({
  comparison,
  rows,
  payment,
}: {
  comparison: Ok;
  rows: readonly ComparedRow[];
  payment: { amountCents: number; analysis: PaymentAnalysis } | null;
}) {
  const current = rows.find((r) => r.origin === "current");
  const others = rows.filter((r) => r.origin !== "current" && r.origin !== "past");
  const best = others[0];
  const saving = current && best?.deltaAnnualCents != null ? -best.deltaAnnualCents : 0;
  const cheapest = current ? saving < SAME_CENTS : false;
  // L'offre la plus proche : l'écart le plus faible avec le contrat en cours.
  const nearest = [...others]
    .filter((r) => r.deltaAnnualCents !== null)
    .sort((a, b) => Math.abs(a.deltaAnnualCents ?? 0) - Math.abs(b.deltaAnnualCents ?? 0))[0];
  const compared = rows.filter((r) => r.origin !== "past").length;
  const a = payment?.analysis;
  const showPayment = payment && a?.status === "ok" && Math.abs(a.gap) > PAYMENT_NOTICE_GAP;
  const peak = comparison.peak;
  const gapCents =
    peak?.hpRate != null && peak.hcRate != null ? (peak.hpRate - peak.hcRate) * 100 : null;
  const showLever = peak !== null && gapCents !== null && gapCents >= 1;

  return (
    <section
      aria-label="Diagnostic"
      className="rounded-card border border-border bg-surface px-6 sm:px-7"
    >
      {(current || best) && (
        <Row
          icon="check"
          title={
            !current && best
              ? `${label(best)} est l'offre la plus économique`
              : cheapest
                ? `Votre contrat est le moins cher des ${compared} offres comparées`
                : `« ${best ? label(best) : ""} » vous aurait coûté ${eur(saving)} de moins par an`
          }
          last={!showPayment && !showLever}
          aside={
            (current ?? best) && (
              <span className="flex flex-none flex-col sm:items-end">
                <span className="wu-amount text-xl whitespace-nowrap">
                  {eur((current ?? (best as ComparedRow)).annualCents)}
                  <span className="text-sm font-medium text-ink-soft"> / an</span>
                </span>
                <span className="wu-label">Coût attendu sur 12 mois</span>
              </span>
            )
          }
        >
          <Text>
            {current && cheapest ? (
              <>
                {current.name} : ≈ {eur(current.annualCents)} par an.
                {nearest && nearest.deltaAnnualCents !== null && (
                  <>
                    {" "}
                    La plus proche, {label(nearest)}, coûterait{" "}
                    {Math.abs(nearest.deltaAnnualCents) < SAME_CENTS
                      ? "le même prix"
                      : `${eur(Math.abs(nearest.deltaAnnualCents))} de ${nearest.deltaAnnualCents > 0 ? "plus" : "moins"}`}
                    .
                  </>
                )}
              </>
            ) : current && best ? (
              <>
                Avec la même consommation sur{" "}
                {comparison.periodDays < 365 ? `${comparison.periodDays} jours` : "12 mois"} :{" "}
                {label(best)} ≈ {eur(best.annualCents)} par an, contre ≈ {eur(current.annualCents)}{" "}
                pour {current.name}.{" "}
                <a href="#offres" className="font-semibold text-ink underline underline-offset-2">
                  Voir les offres
                </a>
              </>
            ) : (
              <>Sur votre consommation réelle, aux prix d&apos;aujourd&apos;hui.</>
            )}
          </Text>
        </Row>
      )}
      {showPayment && payment && a?.status === "ok" && (
        <Row
          icon="tag"
          title={`Votre mensualité pourrait ${a.gap > 0 ? "baisser" : "augmenter"}`}
          last={!showLever}
        >
          <Text>
            ≈ {formatEurFromCents(a.advisedCents, 0)} par mois au lieu de{" "}
            {formatEurFromCents(payment.amountCents, 0)}.
          </Text>
          <ArrowLink href="#contrat-en-cours">Voir le détail de la mensualité</ArrowLink>
        </Row>
      )}
      {showLever && peak && gapCents !== null && (
        <Row
          icon="bulb"
          title={
            cheapest
              ? "Votre levier n'est pas le fournisseur, c'est l'horaire"
              : "L'horaire de vos consommations compte aussi"
          }
          last
        >
          <Text>
            Vous consommez déjà {formatPercent(peak.hcShare)} en heures creuses. Chaque kWh déplacé
            des heures pleines vers les heures creuses économise{" "}
            {formatNumber(gapCents, gapCents < 10 ? 1 : 0)} c€/kWh.
          </Text>
          <ArrowLink href="/previsions">Voir les créneaux de demain</ArrowLink>
        </Row>
      )}
    </section>
  );
}
