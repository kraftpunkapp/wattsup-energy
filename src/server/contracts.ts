import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contract, contractPeriod } from "@/db/schema";
import {
  currentContract,
  findOverlaps,
  latestGrid,
  type DatedContract,
} from "@/domain/tariff/timeline";
import type { MonthlyPayment, PaymentsPerYear } from "@/domain/tariff/payment";
import type { Contract } from "@/domain/tariff/types";
import { addDays, localParts } from "@/lib/time";
import type { HouseholdContext } from "./context";

// Contrats datés et historique de prix (T18b). Toutes les opérations filtrent par
// ctx.householdId : un id d'un autre foyer se comporte comme un id inconnu. Les écritures
// qui touchent aux dates vérifient l'absence de chevauchement dans la même transaction.

export interface ContractWithPeriods extends DatedContract {
  kind: Contract["kind"];
  /** Mensualité prélevée (T59), null si non renseignée. */
  payment: MonthlyPayment | null;
  periods: (DatedContract["periods"][number] & { id: string })[];
}

export interface Subscription {
  startDate: string;
  endDate: string | null;
}

/** Refus métier, messages en français pour l'interface. */
export class ContractError extends Error {
  constructor(readonly messages: string[]) {
    super(messages.join(" ; "));
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const today = (ctx: HouseholdContext) => localParts(new Date(), ctx.timezone).date;

async function load(tx: Tx | typeof db, ctx: HouseholdContext): Promise<ContractWithPeriods[]> {
  const contracts = await tx
    .select()
    .from(contract)
    .where(eq(contract.householdId, ctx.householdId))
    .orderBy(asc(contract.createdAt));
  const periods = await tx
    .select()
    .from(contractPeriod)
    .where(eq(contractPeriod.householdId, ctx.householdId))
    .orderBy(asc(contractPeriod.validFrom));
  return contracts.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    status: c.status,
    startDate: c.startDate,
    endDate: c.endDate,
    payment:
      c.monthlyPaymentCents !== null && c.paymentsPerYear !== null
        ? {
            amountCents: c.monthlyPaymentCents,
            paymentsPerYear: c.paymentsPerYear as PaymentsPerYear,
            settlementMonth: c.settlementMonth,
          }
        : null,
    periods: periods
      .filter((p) => p.contractId === c.id)
      .map((p) => ({ id: p.id, validFrom: p.validFrom, contract: p.config })),
  }));
}

/** Vérifie le contrat `id` après écriture (même transaction). */
async function assertNoOverlap(tx: Tx, ctx: HouseholdContext, id: string) {
  const errors = findOverlaps(await load(tx, ctx), id);
  if (errors.length > 0) throw new ContractError(errors);
}

/** Contrats du foyer : l'actuel, puis les souscrits du plus récent au plus ancien, puis les simulés. */
export async function listContracts(ctx: HouseholdContext): Promise<ContractWithPeriods[]> {
  const all = await load(db, ctx);
  const current = currentContract(all, today(ctx));
  const rank = (c: ContractWithPeriods) =>
    c.id === current?.id ? 0 : c.status === "subscribed" ? 1 : 2;
  return [...all].sort(
    (a, b) => rank(a) - rank(b) || (b.startDate ?? "").localeCompare(a.startDate ?? ""),
  );
}

export async function getContract(ctx: HouseholdContext, id: string) {
  return (await load(db, ctx)).find((c) => c.id === id) ?? null;
}

export interface NewContract {
  name: string;
  contract: Contract;
  /** null : offre simulée. */
  subscription: Subscription | null;
}

export async function createContract(ctx: HouseholdContext, input: NewContract) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contract)
      .values({
        householdId: ctx.householdId,
        name: input.name,
        kind: input.contract.kind,
        status: input.subscription ? "subscribed" : "simulated",
        startDate: input.subscription?.startDate ?? null,
        endDate: input.subscription?.endDate ?? null,
      })
      .returning();
    if (!row) return null;
    await tx.insert(contractPeriod).values({
      contractId: row.id,
      householdId: ctx.householdId,
      validFrom: input.subscription?.startDate ?? today(ctx),
      config: input.contract,
    });
    await assertNoOverlap(tx, ctx, row.id);
    return row;
  });
}

/** Nom et dates de souscription (les prix passent par les périodes). */
export async function updateContract(
  ctx: HouseholdContext,
  id: string,
  input: { name: string; subscription: Subscription | null },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(contract)
      .set({
        name: input.name,
        status: input.subscription ? "subscribed" : "simulated",
        startDate: input.subscription?.startDate ?? null,
        endDate: input.subscription?.endDate ?? null,
      })
      .where(and(eq(contract.id, id), eq(contract.householdId, ctx.householdId)))
      .returning();
    if (row) await assertNoOverlap(tx, ctx, id);
    return row ?? null;
  });
}

/** Mensualité d'un contrat souscrit (null : la retire). Refusée pour une offre simulée. */
export async function setMonthlyPayment(
  ctx: HouseholdContext,
  id: string,
  payment: MonthlyPayment | null,
) {
  const row = await ownedContract(db, ctx, id);
  if (!row) return null;
  if (row.status !== "subscribed") {
    throw new ContractError(["la mensualité se renseigne sur un contrat souscrit"]);
  }
  const [updated] = await db
    .update(contract)
    .set({
      monthlyPaymentCents: payment?.amountCents ?? null,
      paymentsPerYear: payment?.paymentsPerYear ?? null,
      settlementMonth: payment?.settlementMonth ?? null,
    })
    .where(and(eq(contract.id, id), eq(contract.householdId, ctx.householdId)))
    .returning();
  return updated ?? null;
}

async function ownedContract(tx: Tx | typeof db, ctx: HouseholdContext, id: string) {
  const [row] = await tx
    .select()
    .from(contract)
    .where(and(eq(contract.id, id), eq(contract.householdId, ctx.householdId)));
  return row ?? null;
}

const kindMismatch = new ContractError(["le type d'un contrat ne peut pas changer"]);

/** « Nouveaux prix à partir du… » : ajoute une grille datée. */
export async function addPricePeriod(
  ctx: HouseholdContext,
  contractId: string,
  input: { validFrom: string; contract: Contract },
) {
  const owner = await ownedContract(db, ctx, contractId);
  if (!owner) return null;
  if (owner.kind !== input.contract.kind) throw kindMismatch;
  const [row] = await db
    .insert(contractPeriod)
    .values({
      contractId,
      householdId: ctx.householdId,
      validFrom: input.validFrom,
      config: input.contract,
    })
    .onConflictDoUpdate({
      target: [contractPeriod.contractId, contractPeriod.validFrom],
      set: { config: input.contract },
    })
    .returning();
  return row ?? null;
}

export async function updatePricePeriod(
  ctx: HouseholdContext,
  periodId: string,
  input: { validFrom: string; contract: Contract },
) {
  const [period] = await db
    .select({ contractId: contractPeriod.contractId, kind: contract.kind })
    .from(contractPeriod)
    .innerJoin(contract, eq(contract.id, contractPeriod.contractId))
    .where(and(eq(contractPeriod.id, periodId), eq(contractPeriod.householdId, ctx.householdId)));
  if (!period) return null;
  if (period.kind !== input.contract.kind) throw kindMismatch;
  const [row] = await db
    .update(contractPeriod)
    .set({ validFrom: input.validFrom, config: input.contract })
    .where(and(eq(contractPeriod.id, periodId), eq(contractPeriod.householdId, ctx.householdId)))
    .returning();
  return row ?? null;
}

/** Supprime une grille ; la dernière d'un contrat ne peut pas l'être. */
export async function deletePricePeriod(ctx: HouseholdContext, periodId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [period] = await tx
      .select()
      .from(contractPeriod)
      .where(and(eq(contractPeriod.id, periodId), eq(contractPeriod.householdId, ctx.householdId)));
    if (!period) return false;
    const siblings = await tx.$count(
      contractPeriod,
      eq(contractPeriod.contractId, period.contractId),
    );
    if (siblings <= 1) throw new ContractError(["un contrat garde au moins une grille de prix"]);
    await tx.delete(contractPeriod).where(eq(contractPeriod.id, periodId));
    return true;
  });
}

/** Copie simulée d'un contrat, avec sa grille actuelle. */
export async function duplicateContract(ctx: HouseholdContext, id: string) {
  const source = await getContract(ctx, id);
  if (!source) return null;
  return createContract(ctx, {
    name: `${source.name} (copie)`.slice(0, 60),
    contract: latestGrid(source),
    subscription: null,
  });
}

export async function deleteContract(ctx: HouseholdContext, id: string): Promise<boolean> {
  const rows = await db
    .delete(contract)
    .where(and(eq(contract.id, id), eq(contract.householdId, ctx.householdId)))
    .returning({ id: contract.id });
  return rows.length > 0;
}

/**
 * « J'ai changé de contrat le… » : le contrat en cours à cette date est clos la veille et
 * le contrat cible (une offre simulée) devient souscrit à partir de cette date.
 */
export async function switchContract(ctx: HouseholdContext, targetId: string, date: string) {
  return db.transaction(async (tx) => {
    const all = await load(tx, ctx);
    const target = all.find((c) => c.id === targetId);
    if (!target) return false;
    if (target.status === "subscribed") {
      throw new ContractError(["ce contrat est déjà souscrit : modifiez ses dates"]);
    }
    const previous =
      currentContract(all, date) ??
      all.find(
        (c) => c.status === "subscribed" && c.endDate === null && (c.startDate ?? "") < date,
      );
    if (previous) {
      await tx
        .update(contract)
        .set({ endDate: addDays(date, -1) })
        .where(eq(contract.id, previous.id));
    }
    await tx
      .update(contract)
      .set({ status: "subscribed", startDate: date, endDate: null })
      .where(eq(contract.id, targetId));
    await assertNoOverlap(tx, ctx, targetId);
    return true;
  });
}
