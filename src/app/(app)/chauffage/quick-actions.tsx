"use client";

import { callAction } from "@/lib/action";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Badge, button, Card, CardFooter, Icon, Notice, StatTile, tiles } from "@/components/ui";
import { UNITS_FOR, type Fuel, type FuelUnit } from "@/domain/heating/fuel";
import { formatNumber } from "@/lib/format";
import {
  deleteFuelEventAction,
  purchaseAction,
  quickConsumptionAction,
  setStockAction,
  type FuelActionResult,
} from "@/server/actions/fuel";
import { FUEL_LABELS, formatFuelQty, UNIT_NAMES } from "./labels";

export interface FuelSummary {
  fuel: Fuel;
  /** Stock en unité de base : kg (granulés) ou stères (bois). */
  stock: number;
  /** Prix de référence par unité de base (achats des 12 derniers mois), null sans achat chiffré. */
  avgPrice: number | null;
  /** D'où vient ce prix : « achats des 12 derniers mois », « dernier achat, mars 2024 »… */
  priceNote: string | null;
  /** Poids d'un sac de granulés (Réglages). */
  bagKg: number;
}

const UNDO_SECONDS = 10;

const inputClass =
  "h-11 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[15px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30 tabular-nums";
const labelClass = "flex flex-col gap-1.5 text-xs text-muted";

const todayIso = () => new Date().toISOString().slice(0, 10);
const toNumber = (text: string) => Number(text.replace(",", ".").trim() || "NaN");

function Errors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <p role="alert" className="text-sm text-negative">
      {errors.join(" ; ")}
    </p>
  );
}

function PurchaseForm({ fuel, onDone }: { fuel: Fuel; onDone: () => void }) {
  const units = UNITS_FOR[fuel];
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<FuelUnit>(units[0] ?? "bag");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(todayIso());
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      const res = await callAction(() =>
        purchaseAction({
          fuel,
          qty: toNumber(qty),
          unit,
          priceEur: price.trim() === "" ? null : toNumber(price),
          date,
        }),
      );
      if (res.ok) onDone();
      else setErrors(res.errors);
    });
  return (
    <div className="flex flex-col gap-3 rounded-control bg-bg p-3">
      <h3 className="text-sm font-semibold">Achat de {FUEL_LABELS[fuel].toLowerCase()}</h3>
      <div className="grid grid-cols-2 gap-2">
        <label className={labelClass}>
          Quantité
          <input
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Unité
          {units.length > 1 ? (
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as FuelUnit)}
              className={inputClass}
            >
              {units.map((u) => (
                <option key={u} value={u}>
                  {UNIT_NAMES[u]}
                </option>
              ))}
            </select>
          ) : (
            <span className={`${inputClass} flex items-center text-muted`}>{UNIT_NAMES[unit]}</span>
          )}
        </label>
        <label className={labelClass}>
          Prix total (€)
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="facultatif"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <Errors errors={errors} />
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={save} className={button.primary}>
          Enregistrer l&apos;achat
        </button>
        <button type="button" onClick={onDone} className={button.secondary}>
          Annuler
        </button>
      </div>
    </div>
  );
}

/** « Corriger le stock » : stepper prérempli avec le stock calculé ; enregistre un relevé. */
function StockForm({ fuel, initial, onDone }: { fuel: Fuel; initial: number; onDone: () => void }) {
  const unit: FuelUnit = fuel === "pellet" ? "bag" : "stere";
  const step = fuel === "pellet" ? 1 : 0.5;
  const digits = step < 1 ? 1 : 0;
  // Saisie libre (« 12 », « 3,5 ») ; − et + ajustent d'un sac ou d'un demi-stère.
  const [text, setText] = useState(formatNumber(Math.max(0, initial), digits).replace(/\s/g, ""));
  const value = toNumber(text);
  const valid = Number.isFinite(value) && value >= 0;
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const bump = (delta: number) =>
    setText(formatNumber(Math.max(0, (valid ? value : 0) + delta), digits).replace(/\s/g, ""));
  const save = () =>
    startTransition(async () => {
      const res = await callAction(() => setStockAction({ fuel, qty: value, unit }));
      if (res.ok) onDone();
      else setErrors(res.errors);
    });
  const stepper =
    "flex size-11 flex-none items-center justify-center rounded-[8px] border border-border-strong text-lg hover:bg-surface disabled:opacity-40";
  return (
    <div className="flex flex-col gap-3 rounded-control bg-bg p-3">
      <h3 className="text-sm font-semibold">Corriger le stock</h3>
      <p className="text-xs text-muted text-pretty">
        Comptez ce qu&apos;il reste réellement : ce relevé fait foi à partir de maintenant.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Retirer ${formatFuelQty(step, unit)}`}
          disabled={!valid || value <= 0}
          onClick={() => bump(-step)}
          className={stepper}
        >
          −
        </button>
        <label className="flex min-w-0 flex-1 flex-col items-center">
          <input
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={`${UNIT_NAMES[unit]} restants`}
            className="w-full rounded-[6px] bg-transparent text-center text-2xl font-semibold outline-none tabular-nums focus-visible:ring-2 focus-visible:ring-grid/30"
          />
          <span className="text-[11px] text-subtle">{UNIT_NAMES[unit]} restants</span>
        </label>
        <button
          type="button"
          aria-label={`Ajouter ${formatFuelQty(step, unit)}`}
          onClick={() => bump(step)}
          className={stepper}
        >
          +
        </button>
      </div>
      <Errors errors={errors} />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !valid}
          onClick={save}
          className={button.primary}
        >
          Enregistrer le relevé
        </button>
        <button type="button" onClick={onDone} className={button.secondary}>
          Annuler
        </button>
      </div>
    </div>
  );
}

/** Bandeau « Annuler » affiché 10 s après un sac versé. */
function UndoToast({
  label,
  onUndo,
  onExpire,
}: {
  label: string;
  onUndo: () => void;
  onExpire: () => void;
}) {
  const [left, setLeft] = useState(UNDO_SECONDS);
  useEffect(() => {
    if (left <= 0) {
      onExpire();
      return;
    }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onExpire]);
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-sm items-center gap-3 rounded-control border border-panel-edge bg-panel px-4 py-3 text-[13px] text-panel-ink shadow-lg lg:bottom-6"
    >
      <Icon name="check" size={16} />
      <span className="flex-1">{label}</span>
      <button type="button" onClick={onUndo} className="font-semibold text-panel-positive">
        Annuler ({left} s)
      </button>
    </div>
  );
}

export function FuelCard({ summary }: { summary: FuelSummary }) {
  const router = useRouter();
  const [form, setForm] = useState<"purchase" | "stock" | null>(null);
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const { fuel, stock, avgPrice, priceNote, bagKg } = summary;
  const pellet = fuel === "pellet";
  // Le stock arrive en unité de base ; on l'affiche en sacs (granulés) ou stères (bois).
  const shown = pellet ? stock / bagKg : stock;

  const act = (fn: () => Promise<FuelActionResult>, onOk?: (id?: string) => void) =>
    startTransition(async () => {
      const res = await callAction(() => fn());
      if (res.ok) {
        setErrors([]);
        onOk?.(res.id);
      } else setErrors(res.errors);
      router.refresh();
    });

  const close = () => {
    setForm(null);
    router.refresh();
  };

  return (
    <Card
      icon="flame"
      title={FUEL_LABELS[fuel]}
      highlight={undo !== null}
      badges={stock < 0 ? <Badge tone="warning">Stock à corriger</Badge> : undefined}
      description="Stock = dernier relevé + achats − consommations saisies."
    >
      <div className={tiles}>
        <StatTile
          label="Stock restant"
          value={formatNumber(shown, pellet ? 0 : 1)}
          unit={pellet ? "sacs" : "stères"}
          sub={pellet ? `${formatNumber(stock)} kg` : undefined}
          dot={pellet ? "bg-pellet" : "bg-wood"}
        />
        <StatTile
          label="Prix moyen payé"
          value={avgPrice === null ? "—" : formatNumber(pellet ? avgPrice * bagKg : avgPrice, 2)}
          unit={pellet ? "€/sac" : "€/stère"}
          sub={avgPrice === null ? "aucun achat chiffré" : (priceNote ?? undefined)}
        />
      </div>

      {stock < 0 && (
        <Notice
          title="Stock négatif :"
          action={
            <button type="button" onClick={() => setForm("stock")} className={button.primary}>
              Corriger le stock
            </button>
          }
        >
          plus de consommations que d&apos;achats depuis le dernier relevé. Saisissez un achat
          oublié ou comptez ce qu&apos;il reste.
        </Notice>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() =>
          act(
            () => quickConsumptionAction(fuel),
            (id) => id && setUndo({ id, label: pellet ? "1 sac versé" : "½ stère utilisé" }),
          )
        }
        className={`${button.primary} h-12 w-full text-[15px]`}
      >
        <Icon name="plus" size={18} />
        {pellet ? "Sac versé" : "½ stère utilisé"}
      </button>

      {form === "purchase" && <PurchaseForm fuel={fuel} onDone={close} />}
      {form === "stock" && (
        <StockForm fuel={fuel} initial={pellet ? Math.round(shown) : shown} onDone={close} />
      )}
      <Errors errors={errors} />

      {form === null && (
        <CardFooter>
          <button type="button" onClick={() => setForm("purchase")} className={button.secondary}>
            Achat
          </button>
          <button type="button" onClick={() => setForm("stock")} className={button.secondary}>
            Corriger le stock
          </button>
        </CardFooter>
      )}

      {undo && (
        <UndoToast
          key={undo.id}
          label={undo.label}
          onExpire={() => setUndo(null)}
          onUndo={() => {
            const id = undo.id;
            setUndo(null);
            act(() => deleteFuelEventAction(id));
          }}
        />
      )}
    </Card>
  );
}
