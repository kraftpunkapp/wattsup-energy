"use client";

import { callAction } from "@/lib/action";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { button } from "@/components/ui";
import { UNITS_FOR, type Fuel, type FuelUnit } from "@/domain/heating/fuel";
import { monthLabel, nextMonth } from "@/domain/overview";
import { addDays } from "@/lib/time";
import { pastConsumptionAction } from "@/server/actions/fuel";
import { FUEL_LABELS, formatFuelQty, UNIT_NAMES } from "./labels";

// « Consommation passée » : le total d'un mois terminé (saisons d'avant l'appli). Après
// un enregistrement, le mois suivant est proposé pour enchaîner la saisie d'une saison.

const inputClass =
  "h-10 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[14px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30 tabular-nums";
const labelClass = "flex flex-col gap-1.5 text-xs text-muted";
const toNumber = (text: string) => Number(text.replace(",", ".").trim() || "NaN");

const MONTH_NAMES = Array.from(
  { length: 12 },
  (_, i) => monthLabel(`2000-${String(i + 1).padStart(2, "0")}`).split(" ")[0],
);
const YEARS_BACK = 10;

export function PastConsumptionForm({
  fuels,
  currentMonth,
  onClose,
}: {
  fuels: readonly Fuel[];
  /** Mois en cours « AAAA-MM » (non saisissable : il se compte sac par sac). */
  currentMonth: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const lastMonth = addDays(`${currentMonth}-01`, -1).slice(0, 7);
  const [fuel, setFuel] = useState<Fuel>(fuels[0] ?? "pellet");
  const [month, setMonth] = useState(lastMonth);
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<FuelUnit>(UNITS_FOR[fuel][0] ?? "bag");
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const year = Number(month.slice(0, 4));
  const thisYear = Number(currentMonth.slice(0, 4));
  const setPart = (y: number, m: string) => {
    const key = `${y}-${m}`;
    setMonth(key > lastMonth ? lastMonth : key);
  };
  const chooseFuel = (f: Fuel) => {
    setFuel(f);
    setUnit(UNITS_FOR[f][0] ?? "bag");
  };

  const save = () =>
    startTransition(async () => {
      const value = toNumber(qty);
      const res = await callAction(() => pastConsumptionAction({ fuel, qty: value, unit, month }));
      if (!res.ok) {
        setErrors(res.errors);
        return;
      }
      setErrors([]);
      setSaved(`${formatFuelQty(value, unit)} en ${monthLabel(month)}`);
      setQty("");
      const next = nextMonth(month);
      if (next <= lastMonth) setMonth(next);
      router.refresh();
    });

  return (
    <div id="consommation-passee" className="flex flex-col gap-3 rounded-control bg-bg p-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Consommation passée</h3>
        <p className="text-xs text-muted text-pretty">
          Le total d&apos;un mois terminé, d&apos;après vos notes ou vos achats. Ne ressaisissez pas
          un mois déjà compté sac par sac.
        </p>
      </div>
      {fuels.length > 1 && (
        <div role="radiogroup" className="flex gap-1 rounded-[10px] bg-chip p-[3px]">
          {fuels.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={fuel === f}
              onClick={() => chooseFuel(f)}
              className={`flex-1 rounded-[8px] px-3 py-1.5 text-[13px] font-medium ${
                fuel === f ? "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-soft"
              }`}
            >
              {FUEL_LABELS[f]}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className={labelClass}>
          Mois
          <select
            value={month.slice(5)}
            onChange={(e) => setPart(year, e.target.value)}
            className={inputClass}
          >
            {MONTH_NAMES.map((name, i) => {
              const m = String(i + 1).padStart(2, "0");
              return (
                <option key={m} value={m} disabled={`${year}-${m}` > lastMonth}>
                  {name}
                </option>
              );
            })}
          </select>
        </label>
        <label className={labelClass}>
          Année
          <select
            value={year}
            onChange={(e) => setPart(Number(e.target.value), month.slice(5))}
            className={inputClass}
          >
            {Array.from({ length: YEARS_BACK + 1 }, (_, i) => thisYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Quantité consommée
          <input
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Unité
          {UNITS_FOR[fuel].length > 1 ? (
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as FuelUnit)}
              className={inputClass}
            >
              {UNITS_FOR[fuel].map((u) => (
                <option key={u} value={u}>
                  {UNIT_NAMES[u]}
                </option>
              ))}
            </select>
          ) : (
            <span className={`${inputClass} flex items-center text-muted`}>{UNIT_NAMES[unit]}</span>
          )}
        </label>
      </div>
      {errors.length > 0 && (
        <p role="alert" className="text-sm text-negative">
          {errors.join(" ; ")}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-positive">
          Enregistré : {saved}.
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={save} className={button.primary}>
          Enregistrer
        </button>
        <button type="button" onClick={onClose} className={button.secondary}>
          Fermer
        </button>
      </div>
    </div>
  );
}
