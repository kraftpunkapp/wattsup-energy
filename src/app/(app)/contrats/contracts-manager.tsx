"use client";

import { callAction } from "@/lib/action";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { MonthlyPayment, PaymentAnalysis } from "@/domain/tariff/payment";
import { CONTRACT_PRESETS, type ContractInput } from "@/domain/tariff/schema";
import { lapsedContract, periodAt } from "@/domain/tariff/timeline";
import type { Contract } from "@/domain/tariff/types";
import {
  createContractAction,
  deleteContractAction,
  deletePricePeriodAction,
  duplicateContractAction,
  savePricePeriodAction,
  switchContractAction,
  updateContractAction,
  type ActionResult,
} from "@/server/actions/contracts";
import {
  Errors,
  FormButtons,
  GridFields,
  inputClass,
  labelClass,
  SubscriptionFields,
  type SubscriptionValue,
} from "./contract-editor";
import { Badge, button, Card, CardFooter, GroupTitle, Icon, Notice } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm";
import { PageHeader } from "@/components/page-header";
import { GridView, gridSummary } from "./grid-view";
import { KIND_LABELS } from "./labels";
import { PaymentSection } from "./payment-section";

export interface ContractItem {
  id: string;
  name: string;
  kind: Contract["kind"];
  status: "subscribed" | "simulated";
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  /** Mensualité prélevée (T59), null si non renseignée. */
  payment: MonthlyPayment | null;
  /** Du plus ancien au plus récent. */
  periods: { id: string; validFrom: string; contract: Contract }[];
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const todayIso = () => new Date().toISOString().slice(0, 10);

function dates(item: ContractItem, today: string): string {
  if (item.status === "simulated" || !item.startDate) return "Offre à comparer, non souscrite";
  const start = fmtDate(item.startDate);
  if (item.startDate > today) return `Commence le ${start}`;
  if (!item.endDate) return `En cours depuis le ${start}`;
  if (item.endDate >= today)
    return `En cours depuis le ${start} · se termine le ${fmtDate(item.endDate)}`;
  return `Du ${start} au ${fmtDate(item.endDate)}`;
}

function statusBadge(item: ContractItem, today: string) {
  if (item.isCurrent) return { label: "En cours", tone: "active" } as const;
  if (item.status === "simulated") return null;
  if ((item.startDate ?? "") > today) return { label: "À venir", tone: "soft" } as const;
  return { label: "Terminé", tone: "neutral" } as const;
}

type Period = { id: string | null; validFrom: string; contract: Contract };
type Editing =
  | { mode: "presets" }
  | { mode: "create"; initial: ContractInput }
  | { mode: "identity"; item: ContractItem }
  | { mode: "period"; item: ContractItem; period: Period }
  | null;

function useSubmit(onDone: () => void) {
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const submit = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const res = await callAction(() => fn());
      if (res.ok) onDone();
      else setErrors(res.errors);
    });
  return { errors, pending, submit };
}

const card = "flex flex-col gap-4 rounded-card border border-border bg-surface p-5";

function CreateForm({
  initial,
  subscribed,
  onDone,
}: {
  initial: ContractInput;
  subscribed: boolean;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [contract, setContract] = useState(initial.contract);
  const [subscription, setSubscription] = useState<SubscriptionValue | null>(
    subscribed ? { startDate: todayIso(), endDate: null } : null,
  );
  const { errors, pending, submit } = useSubmit(onDone);
  return (
    <section className={card}>
      <h2 className="text-sm font-semibold">Nouveau contrat</h2>
      <label className={labelClass}>
        Nom
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <SubscriptionFields value={subscription} onChange={setSubscription} />
      <GridFields contract={contract} onChange={setContract} />
      <Errors errors={errors} />
      <FormButtons
        pending={pending}
        onCancel={onDone}
        onSave={() => submit(() => createContractAction({ name, contract, subscription }))}
      />
    </section>
  );
}

function IdentityForm({ item, onDone }: { item: ContractItem; onDone: () => void }) {
  const [name, setName] = useState(item.name);
  const [subscription, setSubscription] = useState<SubscriptionValue | null>(
    item.status === "subscribed" && item.startDate
      ? { startDate: item.startDate, endDate: item.endDate }
      : null,
  );
  const { errors, pending, submit } = useSubmit(onDone);
  return (
    <section className={card}>
      <h2 className="text-sm font-semibold">Nom et dates · {item.name}</h2>
      <label className={labelClass}>
        Nom
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <SubscriptionFields value={subscription} onChange={setSubscription} />
      <Errors errors={errors} />
      <FormButtons
        pending={pending}
        onCancel={onDone}
        onSave={() => submit(() => updateContractAction(item.id, { name, subscription }))}
      />
    </section>
  );
}

function PeriodForm({
  item,
  period,
  onDone,
}: {
  item: ContractItem;
  period: Period;
  onDone: () => void;
}) {
  const [validFrom, setValidFrom] = useState(period.validFrom);
  const [contract, setContract] = useState(period.contract);
  const { errors, pending, submit } = useSubmit(onDone);
  return (
    <section className={card}>
      <h2 className="text-sm font-semibold">
        {period.id ? "Modifier les prix" : "Nouveaux prix"} · {item.name}
      </h2>
      {item.status === "subscribed" && (
        <label className={labelClass}>
          {period.id ? "En vigueur à partir du" : "Nouveaux prix à partir du"}
          <input
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            className={inputClass}
          />
        </label>
      )}
      <GridFields contract={contract} onChange={setContract} kindLocked />
      <Errors errors={errors} />
      <FormButtons
        pending={pending}
        onCancel={onDone}
        onSave={() =>
          submit(() => savePricePeriodAction(item.id, period.id, { validFrom, contract }))
        }
      />
    </section>
  );
}

interface CardProps {
  item: ContractItem;
  today: string;
  onEdit: (e: Editing) => void;
  onAct: (fn: () => Promise<ActionResult>) => void;
  pending: boolean;
  /** Contrat en cours, page Contrats : verdict de la mensualité ; absent : section masquée. */
  paymentAnalysis?: PaymentAnalysis | null;
}

function PriceHistory({
  item,
  today,
  shownId,
  onEdit,
  onAct,
  pending,
}: CardProps & { shownId: string }) {
  const confirm = useConfirm();
  return (
    <div className="flex flex-col rounded-control border border-border">
      <h4 className="px-3 pt-2.5 pb-2 text-[11px] font-medium tracking-wide text-muted uppercase">
        Historique des prix
      </h4>
      <ul>
        {[...item.periods].reverse().map((p) => (
          <li key={p.id} className="flex items-center gap-3 border-t border-track px-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                Depuis le {fmtDate(p.validFrom)}
                {item.isCurrent && p.id === shownId && <Badge tone="soft">en vigueur</Badge>}
                {p.validFrom > today && <Badge>à venir</Badge>}
              </span>
              <span className="text-xs text-muted tabular-nums">{gridSummary(p.contract)}</span>
            </div>
            <button
              type="button"
              className={button.icon}
              aria-label={`Modifier les prix du ${fmtDate(p.validFrom)}`}
              title="Modifier ces prix"
              onClick={() => onEdit({ mode: "period", item, period: p })}
            >
              <Icon name="edit" />
            </button>
            {item.periods.length > 1 && (
              <button
                type="button"
                disabled={pending}
                className={button.iconDanger}
                aria-label={`Supprimer les prix du ${fmtDate(p.validFrom)}`}
                title="Supprimer ces prix"
                onClick={async () => {
                  if (await confirm({ title: "Supprimer cette grille de prix ?" }))
                    onAct(() => deletePricePeriodAction(p.id));
                }}
              >
                <Icon name="trash" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SwitchPanel({
  item,
  pending,
  onAct,
  onCancel,
}: Pick<CardProps, "item" | "pending" | "onAct"> & { onCancel: () => void }) {
  const [date, setDate] = useState(todayIso());
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-control bg-bg p-3">
      <label className={`${labelClass} flex-1`}>
        Souscrite à partir du
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={inputClass}
        />
      </label>
      <button
        type="button"
        disabled={pending || !date}
        onClick={() => onAct(() => switchContractAction(item.id, date))}
        className={`${button.primary} h-10`}
      >
        Confirmer
      </button>
      <button type="button" onClick={onCancel} className="h-10 px-2 text-xs text-muted">
        Annuler
      </button>
      <p className="w-full text-[11px] text-subtle">
        Le contrat en cours sera clos la veille de cette date.
      </p>
    </div>
  );
}

function ContractCard(props: CardProps) {
  const { item, today, onEdit, onAct, pending, paymentAnalysis } = props;
  const [showHistory, setShowHistory] = useState(false);
  const [switching, setSwitching] = useState(false);
  const confirm = useConfirm();
  const subscribed = item.status === "subscribed";
  // Prix affichés : ceux du jour ; pour un contrat terminé, ses derniers prix.
  const refDate = item.endDate && item.endDate < today ? item.endDate : today;
  const shown = periodAt(item, refDate);
  const upcoming = subscribed
    ? item.periods.find(
        (p) => p.validFrom > refDate && (!item.endDate || p.validFrom <= item.endDate),
      )
    : undefined;
  const status = statusBadge(item, today);
  const count = item.periods.length;

  return (
    <Card
      as="li"
      icon="bolt"
      highlight={item.isCurrent}
      title={item.name}
      badges={
        <>
          <Badge>{KIND_LABELS[item.kind]}</Badge>
          {status && <Badge tone={status.tone}>{status.label}</Badge>}
        </>
      }
      description={dates(item, today)}
      actions={
        <>
          <button
            type="button"
            className={button.icon}
            aria-label={`Modifier le nom et les dates de « ${item.name} »`}
            title="Nom et dates"
            onClick={() => onEdit({ mode: "identity", item })}
          >
            <Icon name="edit" />
          </button>
          <button
            type="button"
            disabled={pending}
            className={button.icon}
            aria-label={`Dupliquer « ${item.name} » en offre à comparer`}
            title="Dupliquer en offre à comparer"
            onClick={() => onAct(() => duplicateContractAction(item.id))}
          >
            <Icon name="copy" />
          </button>
          <button
            type="button"
            disabled={pending}
            className={button.iconDanger}
            aria-label={`Supprimer « ${item.name} »`}
            title="Supprimer"
            onClick={async () => {
              if (
                await confirm({
                  title: `Supprimer « ${item.name} » ?`,
                  detail: "Son historique de prix est supprimé avec lui.",
                })
              ) {
                onAct(() => deleteContractAction(item.id));
              }
            }}
          >
            <Icon name="trash" />
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {subscribed && (
          <span className="text-[11px] text-muted">
            {shown.validFrom > refDate ? "Prix à partir du" : "Prix depuis le"}{" "}
            {fmtDate(shown.validFrom)}
          </span>
        )}
        <GridView contract={shown.contract} />
        {upcoming && (
          <p className="rounded-control border border-dashed border-border-strong px-3 py-2 text-xs text-muted tabular-nums">
            Nouveaux prix à partir du{" "}
            <span className="font-medium text-ink">{fmtDate(upcoming.validFrom)}</span> :{" "}
            {gridSummary(upcoming.contract)}
          </p>
        )}
      </div>

      {item.isCurrent && paymentAnalysis !== undefined && (
        <PaymentSection contractId={item.id} payment={item.payment} analysis={paymentAnalysis} />
      )}

      {showHistory && <PriceHistory {...props} shownId={shown.id} />}

      {switching ? (
        <SwitchPanel
          item={item}
          pending={pending}
          onAct={onAct}
          onCancel={() => setSwitching(false)}
        />
      ) : (
        <CardFooter>
          {subscribed ? (
            <>
              <button
                type="button"
                className={`${button.link} mr-auto`}
                aria-expanded={showHistory}
                onClick={() => setShowHistory((v) => !v)}
              >
                {showHistory ? "Masquer" : "Voir"} l&apos;historique des prix ({count}{" "}
                {count > 1 ? "grilles" : "grille"})
              </button>
              <button
                type="button"
                className={button.secondary}
                onClick={() =>
                  onEdit({
                    mode: "period",
                    item,
                    period: { id: null, validFrom: todayIso(), contract: shown.contract },
                  })
                }
              >
                <Icon name="plus" size={14} />
                Nouveaux prix
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`${button.secondary} mr-auto`}
                onClick={() => onEdit({ mode: "period", item, period: shown })}
              >
                <Icon name="edit" size={14} />
                Modifier les prix
              </button>
              <button type="button" className={button.primary} onClick={() => setSwitching(true)}>
                <Icon name="check" size={14} />
                J&apos;ai souscrit cette offre
              </button>
            </>
          )}
        </CardFooter>
      )}
    </Card>
  );
}

/** Aucun contrat en cours alors que le dernier s'est terminé : proposer de le rouvrir. */
function LapsedNotice({ item, pending, onAct }: Pick<CardProps, "item" | "pending" | "onAct">) {
  if (!item.startDate || !item.endDate) return null;
  const startDate = item.startDate;
  return (
    <Notice
      title="Aucun contrat en cours aujourd'hui."
      action={
        <button
          type="button"
          disabled={pending}
          className={button.primary}
          onClick={() =>
            onAct(() =>
              updateContractAction(item.id, {
                name: item.name,
                subscription: { startDate, endDate: null },
              }),
            )
          }
        >
          C&apos;est toujours mon contrat
        </button>
      }
    >
      « {item.name} » s&apos;est terminé le {fmtDate(item.endDate)}. Si c&apos;est toujours votre
      contrat, retirez sa date de fin : une hausse de prix se saisit avec « Nouveaux prix », sans
      clore le contrat.
    </Notice>
  );
}

export function ContractsManager({
  contracts,
  today,
  paymentAnalysis,
  subtitle,
  diagnostic,
  beside,
  history,
  extra,
}: {
  contracts: ContractItem[];
  /** Jour local du foyer (AAAA-MM-JJ). */
  today: string;
  /** Page Contrats : verdict de la mensualité du contrat en cours (null : non calculé). */
  paymentAnalysis?: PaymentAnalysis | null;
  /** Absent (parcours d'accueil) : pas d'en-tête de page, seulement le bouton d'ajout. */
  subtitle?: string;
  /** Diagnostic sous l'en-tête (rendu par le serveur). */
  diagnostic?: ReactNode;
  /** Colonne à droite du contrat en cours : les offres les plus proches. */
  beside?: ReactNode;
  /** Historique des contrats, sous le contrat en cours. */
  history?: ReactNode;
  /** Calendriers Tempo et sobriété, en bas de page. */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const done = () => {
    setEditing(null);
    router.refresh();
  };
  const act = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const res = await callAction(() => fn());
      setErrors(res.ok ? [] : res.errors);
      router.refresh();
    });

  const addButton =
    editing === null ? (
      <button
        type="button"
        onClick={() => setEditing({ mode: "presets" })}
        className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-strong bg-surface px-4 text-sm font-semibold hover:bg-bg"
      >
        <Icon name="plus" size={16} />
        Ajouter un contrat
      </button>
    ) : null;
  const header =
    subtitle !== undefined ? (
      <PageHeader title="Contrats" subtitle={subtitle}>
        {addButton}
      </PageHeader>
    ) : (
      <div className="flex">{addButton}</div>
    );

  if (editing?.mode === "create") {
    return (
      <>
        {header}
        <CreateForm
          initial={editing.initial}
          subscribed={!contracts.some((c) => c.isCurrent)}
          onDone={done}
        />
      </>
    );
  }
  if (editing?.mode === "identity") {
    return (
      <>
        {header}
        <IdentityForm item={editing.item} onDone={done} />
      </>
    );
  }
  if (editing?.mode === "period") {
    return (
      <>
        {header}
        <PeriodForm item={editing.item} period={editing.period} onDone={done} />
      </>
    );
  }

  const lapsed = lapsedContract(contracts, today);
  const subscribed = contracts.filter((c) => c.status === "subscribed" && !c.isCurrent);
  const current = contracts.filter((c) => c.isCurrent);
  const others = [
    { title: "À venir", items: subscribed.filter((c) => (c.startDate ?? "") > today) },
    { title: "Contrats passés", items: subscribed.filter((c) => (c.startDate ?? "") <= today) },
    { title: "Offres à comparer", items: contracts.filter((c) => c.status === "simulated") },
  ].filter((g) => g.items.length > 0);
  const otherCount = others.reduce((a, g) => a + g.items.length, 0);

  const card = (item: ContractItem) => (
    <ContractCard
      key={item.id}
      item={item}
      today={today}
      onEdit={setEditing}
      onAct={act}
      pending={pending}
      paymentAnalysis={item.isCurrent ? paymentAnalysis : undefined}
    />
  );

  return (
    <>
      {header}
      {lapsed && <LapsedNotice item={lapsed} pending={pending} onAct={act} />}
      <Errors errors={errors} />
      {editing?.mode === "presets" && (
        <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold">Partir d&apos;une offre de référence</h2>
          <p className="text-xs text-subtle">
            Grilles TTC indicatives (9 kVA) : vérifiez les prix sur votre facture ou chez votre
            fournisseur avant d&apos;enregistrer.
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-2">
            {CONTRACT_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setEditing({ mode: "create", initial: structuredClone(p) })}
                className="flex min-h-14 flex-col items-start gap-1 rounded-control border border-border p-3 text-left hover:bg-bg"
              >
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-xs text-subtle">{KIND_LABELS[p.contract.kind]}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className={`${button.link} self-start`}
          >
            Annuler
          </button>
        </section>
      )}
      {contracts.length === 0 && editing?.mode !== "presets" && (
        <p className="rounded-card border border-dashed border-dash bg-surface p-5 text-sm text-muted">
          Ajoutez votre contrat actuel (avec sa date de début) pour commencer, puis les offres à
          comparer.
        </p>
      )}
      {diagnostic}
      <div className="flex flex-wrap items-start gap-4">
        {current.length > 0 && (
          <section id="contrat-en-cours" className="flex min-w-0 flex-[1.2_1_460px] flex-col gap-2">
            <GroupTitle>Contrat en cours</GroupTitle>
            <ul className="flex flex-col gap-3">{current.map(card)}</ul>
          </section>
        )}
        {beside && <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-4">{beside}</div>}
      </div>
      {history}
      {extra}
      {otherCount > 0 && (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            Gérer mes autres contrats et offres à comparer ({otherCount})
            <span className="transition-transform group-open:rotate-90">
              <Icon name="chevron" size={14} />
            </span>
          </summary>
          <div className="flex flex-col gap-5 pt-2">
            {others.map((g) => (
              <section key={g.title} className="flex flex-col gap-2">
                <GroupTitle>{g.title}</GroupTitle>
                <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-3">
                  {g.items.map(card)}
                </ul>
              </section>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
