"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, button, Icon } from "@/components/ui";
import { monthLabel } from "@/domain/overview";
import {
  PAYMENTS_PER_YEAR,
  type MonthlyPayment,
  type PaymentAnalysis,
} from "@/domain/tariff/payment";
import { formatEurFromCents } from "@/lib/format";
import { saveMonthlyPaymentAction } from "@/server/actions/contracts";
import { Errors, inputClass, labelClass } from "./contract-editor";

// Mensualité du contrat en cours (T59, SPEC §7.13) : saisie facultative et verdict sur
// l'année (bien ajustée, trop élevée, trop basse), mensualité conseillée, régularisation.

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const monthName = (m: number) => monthLabel(`2000-${String(m).padStart(2, "0")}`).split(" ")[0];
const eur = (cents: number) => formatEurFromCents(cents, 0);
/** Solde de régularisation considéré comme à l'équilibre. */
const BALANCED_CENTS = 1000;

const VERDICTS = {
  ok: { label: "Bien ajustée", tone: "positive" },
  high: { label: "Trop élevée", tone: "warning" },
  low: { label: "Trop basse", tone: "warning" },
} as const;

function PaymentForm({
  contractId,
  payment,
  onDone,
}: {
  contractId: string;
  payment: MonthlyPayment | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(
    payment ? String(payment.amountCents / 100).replace(".", ",") : "",
  );
  const [count, setCount] = useState<number>(payment?.paymentsPerYear ?? 12);
  const [month, setMonth] = useState<number | null>(payment?.settlementMonth ?? null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const save = (input: unknown) =>
    startTransition(async () => {
      const res = await saveMonthlyPaymentAction(contractId, input);
      if (!res.ok) return setErrors(res.errors);
      onDone();
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3 rounded-control bg-bg p-3">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,140px),1fr))] gap-2">
        <label className={labelClass}>
          Mensualité (€)
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="ex. 95"
            className={`${inputClass} tabular-nums`}
          />
        </label>
        <label className={labelClass}>
          Prélèvements par an
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className={inputClass}
          >
            {PAYMENTS_PER_YEAR.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Facture de régularisation
          <select
            value={month ?? ""}
            onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : null)}
            className={inputClass}
          >
            <option value="">Je ne sais pas</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                en {monthName(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Errors errors={errors} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          className={button.primary}
          onClick={() => save({ amount, paymentsPerYear: count, settlementMonth: month })}
        >
          Enregistrer
        </button>
        <button type="button" onClick={onDone} className="h-9 px-2 text-xs text-muted">
          Annuler
        </button>
        {payment && (
          <button
            type="button"
            disabled={pending}
            onClick={() => save(null)}
            className={`${button.link} ml-auto`}
          >
            Retirer la mensualité
          </button>
        )}
      </div>
      <p className="text-[11px] text-subtle">
        Le montant prélevé chaque mois figure sur votre échéancier ou votre facture. Le mois de la
        régularisation permet d&apos;estimer son montant.
      </p>
    </div>
  );
}

function Verdict({ analysis }: { analysis: PaymentAnalysis }) {
  if (analysis.status === "insufficient") {
    return (
      <p className="text-xs text-muted">
        {analysis.months} mois de données sur 12 : le verdict sera disponible après une année
        complète, hiver compris.
      </p>
    );
  }
  const v = VERDICTS[analysis.verdict];
  const s = analysis.settlement;
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={v.tone}>{v.label}</Badge>
        <span className="text-ink-soft tabular-nums">
          ≈ {eur(analysis.paidAnnualCents)} prélevés par an pour ≈{" "}
          {eur(analysis.expectedAnnualCents)} de consommation attendue
        </span>
      </p>
      {analysis.verdict !== "ok" && (
        <p className="tabular-nums">
          Mensualité conseillée :{" "}
          <span className="font-semibold">{eur(analysis.advisedCents)}</span>
        </p>
      )}
      {s && (
        <p className="text-ink-soft tabular-nums">
          Régularisation de {monthLabel(s.month)} :{" "}
          {Math.abs(s.balanceCents) < BALANCED_CENTS ? (
            "à peu près à l'équilibre"
          ) : s.balanceCents > 0 ? (
            <span className="font-medium text-negative">environ {eur(s.balanceCents)} à payer</span>
          ) : (
            <span className="font-medium text-positive">
              environ {eur(-s.balanceCents)} en votre faveur
            </span>
          )}
        </p>
      )}
      <p className="text-[11px] text-subtle">
        D&apos;après vos 12 derniers mois de consommation aux prix actuels. Être en avance
        l&apos;été et en retard l&apos;hiver est normal : la mensualité lisse l&apos;année.
      </p>
    </div>
  );
}

export function PaymentSection({
  contractId,
  payment,
  analysis,
}: {
  contractId: string;
  payment: MonthlyPayment | null;
  /** null : pas encore calculé (aucune donnée). */
  analysis: PaymentAnalysis | null;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <PaymentForm contractId={contractId} payment={payment} onDone={() => setEditing(false)} />
    );
  }
  if (!payment) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-[10px] border border-dashed border-dash p-3 text-left text-[13px] text-ink-soft hover:bg-bg"
      >
        + Indiquer votre mensualité
        <span className="block text-[11px] text-subtle">
          pour vérifier qu&apos;elle couvre votre consommation sur l&apos;année
        </span>
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px]">
          <span className="text-muted">Mensualité</span>{" "}
          <span className="font-semibold tabular-nums">{eur(payment.amountCents)}</span>
          <span className="text-muted">
            {" "}
            · {payment.paymentsPerYear} prélèvements par an
            {payment.settlementMonth !== null &&
              ` · régularisation en ${monthName(payment.settlementMonth)}`}
          </span>
        </p>
        <button
          type="button"
          className={button.icon}
          aria-label="Modifier la mensualité"
          title="Modifier la mensualité"
          onClick={() => setEditing(true)}
        >
          <Icon name="edit" />
        </button>
      </div>
      {analysis && <Verdict analysis={analysis} />}
    </div>
  );
}
