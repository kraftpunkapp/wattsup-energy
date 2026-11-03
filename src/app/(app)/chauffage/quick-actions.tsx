"use client";

import { callAction } from "@/lib/action";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Badge, button, Icon, Notice } from "@/components/ui";
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
  /** Sacs par palette (Réglages) : échelle de la jauge du stock. */
  bagsPerPallet: number;
  /** Prévision de réapprovisionnement (granulés), null sans assez de données. */
  refill?: RefillSummary | null;
}

/** Ce que la prévision dit du stock, déjà calculé côté serveur (sacs entiers). */
export interface RefillSummary {
  /** Fin de la saison en cours (« fin mai »), null hors saison. */
  currentEnd: string | null;
  /** Besoin jusqu'à la fin de saison, hiver moyen, et marge restante (peut être négative). */
  need: number | null;
  spare: number | null;
  /** Besoin d'un hiver rigoureux et s'il passerait avec le stock. */
  rigorousNeed: number | null;
  rigorousOk: boolean | null;
  /** Sacs à acheter avant la fin de la saison en cours (hiver moyen). */
  toBuy: number | null;
  /** Rythme mesuré sur 30 jours : sacs par jour, null sans consommation saisie. */
  perDay: number | null;
  /** Saison prochaine, hiver moyen : sacs et coût (€) au dernier prix connu. */
  nextLabel: string;
  nextBags: number;
  nextCostEur: number | null;
}

const UNDO_SECONDS = 10;

const inputClass =
  "h-11 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[15px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/30 tabular-nums";
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
            className="w-full rounded-[6px] bg-transparent text-center text-2xl font-semibold outline-none tabular-nums focus-visible:ring-2 focus-visible:ring-accent/30"
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
  const { fuel, stock, avgPrice, priceNote, bagKg, refill } = summary;
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

  const toBuy = refill?.toBuy ?? null;
  const known =
    refill !== null && refill !== undefined && refill.need !== null && refill.spare !== null;
  // Jauge du stock : un sac plein = la palette (ou le stock si plus grand) ; le trait marque le besoin.
  const palette = Math.max(summary.bagsPerPallet, 1);
  const gaugeMax = Math.max(palette, Math.ceil(shown), refill?.need ?? 0);
  const box = "flex flex-col gap-1 rounded-[14px] bg-bg p-4";
  const action =
    "inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface px-4.5 text-[15px] font-semibold hover:bg-bg disabled:opacity-60";

  return (
    <section
      aria-labelledby={`fuel-${fuel}`}
      className={`flex flex-wrap gap-7 rounded-card border bg-surface p-6 sm:p-7 ${
        undo !== null ? "border-accent shadow-[0_0_0_3px_rgba(26,26,26,0.10)]" : "border-border"
      }`}
    >
      <div className="flex min-w-0 flex-[1.2_1_420px] flex-col gap-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`fuel-${fuel}`} className="flex items-center gap-2.5 text-xl font-bold">
            <span
              aria-hidden
              className={`flex size-9 flex-none items-center justify-center rounded-[10px] ${
                pellet ? "bg-pellet/15 text-pellet" : "bg-wood/15 text-wood"
              }`}
            >
              <Icon name="flame" size={19} />
            </span>
            {FUEL_LABELS[fuel]}
          </h2>
          {stock < 0 ? (
            <Badge tone="warning">Stock à corriger</Badge>
          ) : (
            known && (
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold ${
                  toBuy !== null && toBuy > 0 ? "bg-track text-ink" : "bg-battery/15 text-positive"
                }`}
              >
                <Icon name={toBuy !== null && toBuy > 0 ? "bulb" : "check"} size={15} />
                {toBuy !== null && toBuy > 0
                  ? `Il manquera ≈ ${formatNumber(toBuy)} sac${toBuy > 1 ? "s" : ""} avant la fin de l'hiver`
                  : "Stock suffisant pour finir l'hiver"}
              </span>
            )
          )}
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <p className="text-[64px] leading-[0.95] font-bold tracking-[-0.03em] tabular-nums sm:text-[72px]">
            <span>{formatNumber(shown, pellet ? 0 : 1)}</span>{" "}
            <span className="text-[26px] font-semibold tracking-normal">
              {pellet ? "sacs" : "stères"}
            </span>
          </p>
          <p className="pb-2 text-[15px] text-ink-soft">
            {pellet ? `${formatNumber(stock)} kg en stock · ` : ""}stock = dernier relevé + achats −
            consommations saisies
          </p>
        </div>
        {pellet && stock >= 0 && (
          <div className="flex flex-col gap-2">
            <div
              role="img"
              aria-label={`${formatNumber(shown)} sacs en stock${
                known && refill?.need !== null && refill
                  ? `, ${formatNumber(refill.need)} nécessaires jusqu'à la fin de la saison pour un hiver moyen`
                  : ""
              }`}
              className="relative h-3.5 rounded-[7px] bg-track"
            >
              <div
                className="wu-grow-x absolute inset-y-0 left-0 rounded-[7px] bg-pellet"
                style={{ width: `${Math.min(100, (shown / gaugeMax) * 100)}%` }}
              />
              {known && refill?.need != null && (
                <div
                  className="absolute -top-[5px] -bottom-[5px] w-0.5 bg-ink"
                  style={{ left: `${Math.min(100, (refill.need / gaugeMax) * 100)}%` }}
                />
              )}
            </div>
            <div className="relative h-[18px] text-[13px] text-ink-soft">
              {known && refill?.need != null && (
                <span
                  className="absolute -translate-x-1/2 font-semibold whitespace-nowrap"
                  style={{ left: `${Math.min(88, Math.max(12, (refill.need / gaugeMax) * 100))}%` }}
                >
                  besoin jusqu&apos;à {refill.currentEnd ?? "la fin de saison"} :{" "}
                  {formatNumber(refill.need)}
                </span>
              )}
              {gaugeMax === palette && (
                <span className="absolute right-0 text-muted">
                  {formatNumber(palette)} = 1 palette
                </span>
              )}
            </div>
          </div>
        )}

        {stock < 0 && (
          <Notice
            icon="bulb"
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

        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              act(
                () => quickConsumptionAction(fuel),
                (id) => id && setUndo({ id, label: pellet ? "1 sac versé" : "½ stère utilisé" }),
              )
            }
            className="inline-flex min-h-14 flex-[1_1_220px] items-center justify-center gap-2.5 rounded-xl bg-ink px-5 text-[17px] font-semibold text-bg disabled:opacity-60"
          >
            <Icon name="download" size={20} />
            {pellet ? "J'ai versé un sac" : "J'ai brûlé ½ stère"}
          </button>
          <button type="button" onClick={() => setForm("purchase")} className={action}>
            <Icon name="plus" size={17} />
            Achat
          </button>
          <button type="button" onClick={() => setForm("stock")} className={action}>
            <Icon name="edit" size={17} />
            Corriger le stock
          </button>
        </div>

        {form === "purchase" && <PurchaseForm fuel={fuel} onDone={close} />}
        {form === "stock" && (
          <StockForm fuel={fuel} initial={pellet ? Math.round(shown) : shown} onDone={close} />
        )}
        <Errors errors={errors} />
      </div>

      <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-3">
        {known && refill && refill.need !== null && refill.spare !== null && (
          <div className={box}>
            <span className="text-[13px] font-bold text-ink-soft">
              D&apos;ici {refill.currentEnd ?? "la fin de saison"} · estimation
            </span>
            <span className="text-lg font-bold tabular-nums">
              ≈ {formatNumber(refill.need)} sacs nécessaires pour un hiver moyen
            </span>
            <span className="text-sm text-ink-soft text-pretty">
              {refill.spare >= 0
                ? `Il vous en resterait ≈ ${formatNumber(refill.spare)}.`
                : `Il en manquerait ≈ ${formatNumber(-refill.spare)}.`}
              {refill.rigorousNeed !== null &&
                refill.rigorousOk !== null &&
                ` ${refill.rigorousOk ? "Même un" : "Un"} hiver rigoureux (${formatNumber(refill.rigorousNeed)} sacs) ${refill.rigorousOk ? "passerait" : "ne passerait pas"}.`}
            </span>
          </div>
        )}
        {refill && refill.perDay !== null && refill.perDay > 0 && (
          <div className={box}>
            <span className="text-[13px] font-bold text-ink-soft">Au rythme actuel · mesuré</span>
            <span className="text-lg font-bold tabular-nums">
              {refill.perDay >= 1
                ? `≈ ${formatNumber(refill.perDay, 1)} sacs par jour`
                : `≈ 1 sac tous les ${formatNumber(Math.round(1 / refill.perDay))} jours`}
            </span>
            <span className="text-sm text-ink-soft text-pretty">
              Calculé sur les sacs versés ces 30 derniers jours ; le rythme change avec le froid.
            </span>
          </div>
        )}
        <div className={box}>
          <span className="text-[13px] font-bold text-ink-soft">Prix moyen payé</span>
          <span className="text-lg font-bold tabular-nums">
            {avgPrice === null
              ? "—"
              : `${formatNumber(pellet ? avgPrice * bagKg : avgPrice, 2)} ${pellet ? "€/sac" : "€/stère"}`}
          </span>
          <span className="text-sm text-ink-soft">
            {avgPrice === null ? "aucun achat chiffré" : priceNote}
          </span>
        </div>
        {refill && (
          <div className="flex items-center gap-3 rounded-[14px] border border-border p-4">
            <span
              aria-hidden
              className="flex size-10 flex-none items-center justify-center rounded-xl bg-pellet/15 text-pellet"
            >
              <Icon name="layout" size={20} />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-base font-bold">
                Prochain achat : saison {refill.nextLabel}
              </span>
              <span className="text-sm text-ink-soft">
                ≈ {formatNumber(refill.nextBags)} sacs
                {refill.nextCostEur !== null &&
                  `, ≈ ${formatNumber(refill.nextCostEur)} € au dernier prix d'achat`}{" "}
                (hiver moyen)
              </span>
            </div>
          </div>
        )}
      </div>

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
    </section>
  );
}
