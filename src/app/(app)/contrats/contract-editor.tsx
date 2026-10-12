"use client";

import { useState } from "react";
import { CONTRACT_PRESETS, type ContractInput } from "@/domain/tariff/schema";
import {
  MONTH_SHORT,
  monthsPreset,
  SUMMER_MONTHS,
  WINTER_MONTHS,
  type MonthsPreset,
} from "@/domain/tariff/seasons";
import type { Contract, CustomRule, TempoColor, TimeRange } from "@/domain/tariff/types";
import { formatDuration } from "@/lib/format";
import { KIND_LABELS } from "./labels";

const DAYS = ["L", "M", "M", "J", "V", "S", "D"];
const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const COLORS: { id: TempoColor; label: string; dot: string }[] = [
  { id: "bleu", label: "Bleu", dot: "bg-grid" },
  { id: "blanc", label: "Blanc", dot: "bg-dash" },
  { id: "rouge", label: "Rouge", dot: "bg-eheat" },
];

const inputClass =
  "h-10 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[13px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30";
const labelClass = "flex flex-col gap-1.5 text-xs text-muted";
const smallButton =
  "rounded-[8px] border border-border-strong px-2.5 py-1.5 text-xs text-ink-soft hover:bg-bg";

const presetFor = (kind: Contract["kind"]) =>
  structuredClone(CONTRACT_PRESETS.find((p) => p.contract.kind === kind) as ContractInput);

/** Champ décimal : accepte la virgule, garde la saisie telle quelle tant qu'elle est incomplète. */
function DecimalField({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value).replace(".", ",") : "");
  return (
    <label className={labelClass}>
      {label}
      <span className="flex items-center gap-2">
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(Number(e.target.value.replace(",", ".").trim() || "NaN"));
          }}
          className={`${inputClass} text-right tabular-nums`}
        />
        <span className="w-14 flex-none text-[11px] text-subtle">{unit}</span>
      </span>
    </label>
  );
}

function RangesField({
  ranges,
  onChange,
}: {
  ranges: TimeRange[];
  onChange: (r: TimeRange[]) => void;
}) {
  const set = (i: number, patch: Partial<TimeRange>) =>
    onChange(ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {ranges.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="time"
            step={1800}
            value={r.from}
            onChange={(e) => set(i, { from: e.target.value })}
            className={inputClass}
            aria-label="Début"
          />
          <span className="text-subtle">→</span>
          <input
            type="time"
            step={1800}
            value={r.to === "24:00" ? "00:00" : r.to}
            onChange={(e) => set(i, { to: e.target.value === "00:00" ? "24:00" : e.target.value })}
            className={inputClass}
            aria-label="Fin"
          />
          {ranges.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(ranges.filter((_, j) => j !== i))}
              className={smallButton}
              aria-label="Retirer la plage"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...ranges, { from: "12:00", to: "14:00" }])}
        className={`${smallButton} self-start`}
      >
        + Plage
      </button>
    </div>
  );
}

const MONTH_CHOICES: { id: MonthsPreset; label: string }[] = [
  { id: "all", label: "Toujours" },
  { id: "winter", label: "Hiver" },
  { id: "summer", label: "Été" },
  { id: "custom", label: "Mois…" },
];

/** Mois d'une règle (T56) : toute l'année, hiver (nov. – mars), été (avr. – oct.) ou au choix. */
function MonthsField({
  months,
  onChange,
}: {
  months: number[] | undefined;
  onChange: (m: number[] | undefined) => void;
}) {
  const preset = monthsPreset(months);
  const [choosing, setChoosing] = useState(preset === "custom");
  const active = choosing ? "custom" : preset;
  const pick = (id: MonthsPreset) => {
    setChoosing(id === "custom");
    if (id === "all") onChange(undefined);
    else if (id === "winter") onChange([...WINTER_MONTHS]);
    else if (id === "summer") onChange([...SUMMER_MONTHS]);
    else onChange(months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">Période</span>
      <div
        role="radiogroup"
        aria-label="Période"
        className="flex gap-1 rounded-[10px] bg-chip p-[3px]"
      >
        {MONTH_CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active === c.id}
            onClick={() => pick(c.id)}
            className={`flex-1 rounded-[8px] px-1.5 py-1.5 text-xs font-medium ${
              active === c.id ? "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : ""
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      {active === "custom" && (
        <div className="grid grid-cols-6 gap-1" role="group" aria-label="Mois">
          {MONTH_SHORT.map((name, i) => {
            const month = i + 1;
            const on = months?.includes(month) ?? true;
            return (
              <button
                key={month}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const list = months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
                  onChange(
                    on ? list.filter((m) => m !== month) : [...list, month].sort((a, b) => a - b),
                  );
                }}
                className={`h-8 rounded-[8px] text-[11px] font-medium ${on ? "bg-ink text-bg" : "bg-chip"}`}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RuleEditor({
  rule,
  onChange,
  onRemove,
}: {
  rule: CustomRule;
  onChange: (r: CustomRule) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-border p-3">
      <div className="flex items-end gap-2">
        <label className={`${labelClass} flex-1`}>
          Libellé
          <input
            value={rule.label}
            onChange={(e) => onChange({ ...rule, label: e.target.value })}
            className={inputClass}
          />
        </label>
        {onRemove && (
          <button type="button" onClick={onRemove} className={`${smallButton} h-10`}>
            Retirer
          </button>
        )}
      </div>
      <div className="flex gap-1" role="group" aria-label="Jours">
        {DAYS.map((d, i) => {
          const day = i + 1;
          const on = rule.days.includes(day);
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              aria-label={DAY_NAMES[i]}
              onClick={() =>
                onChange({
                  ...rule,
                  days: on ? rule.days.filter((x) => x !== day) : [...rule.days, day].sort(),
                })
              }
              className={`size-9 rounded-[8px] text-xs font-medium ${on ? "bg-ink text-bg" : "bg-chip"}`}
            >
              {d}
            </button>
          );
        })}
      </div>
      <MonthsField
        months={rule.months}
        onChange={(months) => {
          const next = { ...rule, months };
          if (months === undefined) delete next.months;
          onChange(next);
        }}
      />
      <RangesField ranges={rule.ranges} onChange={(ranges) => onChange({ ...rule, ranges })} />
      <DecimalField
        label="Prix"
        value={rule.price}
        unit="€/kWh"
        onChange={(price) => onChange({ ...rule, price })}
      />
    </div>
  );
}

/** Champs d'une grille de prix ; le type n'est modifiable qu'à la création d'un contrat. */
export function GridFields({
  contract,
  onChange,
  kindLocked,
}: {
  contract: Contract;
  onChange: (c: Contract) => void;
  kindLocked?: boolean;
}) {
  // Remonter les champs décimaux quand le type change (leur texte est local).
  const [formKey, setFormKey] = useState(0);
  const switchKind = (kind: Contract["kind"]) => {
    if (kind === contract.kind) return;
    onChange(presetFor(kind).contract);
    setFormKey((k) => k + 1);
  };

  return (
    <>
      {!kindLocked && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Type</span>
          <div role="radiogroup" className="flex gap-1 rounded-[10px] bg-chip p-[3px]">
            {(Object.keys(KIND_LABELS) as Contract["kind"][]).map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={contract.kind === kind}
                onClick={() => switchKind(kind)}
                className={`flex-1 rounded-[8px] px-2 py-2 text-[13px] font-medium ${
                  contract.kind === kind ? "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : ""
                }`}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div key={formKey} className="flex flex-col gap-4">
        <DecimalField
          label="Abonnement"
          value={contract.subscriptionEurYear}
          unit="€/an"
          onChange={(subscriptionEurYear) => onChange({ ...contract, subscriptionEurYear })}
        />

        {contract.kind === "base" && (
          <DecimalField
            label="Prix du kWh"
            value={contract.priceEurKwh}
            unit="€/kWh"
            onChange={(priceEurKwh) => onChange({ ...contract, priceEurKwh })}
          />
        )}

        {contract.kind === "hphc" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <DecimalField
                label="Heures pleines"
                value={contract.prices.hp}
                unit="€/kWh"
                onChange={(hp) => onChange({ ...contract, prices: { ...contract.prices, hp } })}
              />
              <DecimalField
                label="Heures creuses"
                value={contract.prices.hc}
                unit="€/kWh"
                onChange={(hc) => onChange({ ...contract, prices: { ...contract.prices, hc } })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted">Plages d&apos;heures creuses</span>
              <RangesField
                ranges={contract.hcRanges}
                onChange={(hcRanges) => onChange({ ...contract, hcRanges })}
              />
            </div>
          </>
        )}

        {contract.kind === "tempo" && (
          <div className="flex flex-col gap-3">
            <span className="text-xs text-muted">
              Heures creuses de 22 h à 6 h, fixées par Tempo.
            </span>
            {COLORS.map((c) => (
              <div key={c.id} className="grid grid-cols-[72px_1fr_1fr] items-end gap-3">
                <span className="flex h-10 items-center gap-2 text-[13px] font-medium">
                  <span className={`size-2.5 rounded-[3px] ${c.dot}`} />
                  {c.label}
                </span>
                {(["hp", "hc"] as const).map((slot) => (
                  <DecimalField
                    key={slot}
                    label={slot === "hp" ? "HP" : "HC"}
                    value={contract.prices[c.id][slot]}
                    unit="€/kWh"
                    onChange={(v) =>
                      onChange({
                        ...contract,
                        prices: {
                          ...contract.prices,
                          [c.id]: { ...contract.prices[c.id], [slot]: v },
                        },
                      })
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        {contract.kind === "custom" && (
          <div className="flex flex-col gap-3">
            <span className="text-xs text-muted">
              Règles appliquées dans l&apos;ordre : la première qui couvre un moment fixe son prix.
              Chaque minute de la semaine doit être couverte, tous les mois de l&apos;année.
            </span>
            <label className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={contract.dayStartHour === 6}
                onChange={(e) => {
                  const next = { ...contract, dayStartHour: 6 as const };
                  if (!e.target.checked) delete (next as { dayStartHour?: 6 }).dayStartHour;
                  onChange(next);
                }}
                className="mt-0.5 size-4 accent-[var(--color-grid)]"
              />
              <span className="flex flex-col gap-0.5">
                La journée commence à 6 h
                <span className="text-[11px] text-subtle text-pretty">
                  Avant 6 h, le jour et la saison sont ceux de la veille : la nuit du dimanche au
                  lundi compte encore pour le week-end.
                </span>
              </span>
            </label>
            {contract.rules.map((rule, i) => (
              <RuleEditor
                key={i}
                rule={rule}
                onChange={(r) =>
                  onChange({
                    ...contract,
                    rules: contract.rules.map((x, j) => (j === i ? r : x)),
                  })
                }
                onRemove={
                  contract.rules.length > 1
                    ? () =>
                        onChange({
                          ...contract,
                          rules: contract.rules.filter((_, j) => j !== i),
                        })
                    : undefined
                }
              />
            ))}
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...contract,
                  rules: [
                    ...contract.rules,
                    {
                      label: `Règle ${contract.rules.length + 1}`,
                      days: [1, 2, 3, 4, 5, 6, 7],
                      ranges: [{ from: "00:00", to: "24:00" }],
                      price: 0.2,
                    },
                  ],
                })
              }
              className={`${smallButton} self-start`}
            >
              + Règle
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function Errors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <ul role="alert" className="flex flex-col gap-1 text-sm text-negative">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

export function FormButtons({
  pending,
  onSave,
  onCancel,
}: {
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        className="flex h-10 items-center rounded-[8px] bg-ink px-4 text-[13px] font-medium text-bg disabled:opacity-60"
      >
        Enregistrer
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="flex h-10 items-center rounded-[8px] border border-border-strong px-4 text-[13px] text-ink-soft hover:bg-bg"
      >
        Annuler
      </button>
    </div>
  );
}

export interface SubscriptionValue {
  startDate: string;
  endDate: string | null;
}

/** Durée saisie, pour repérer d'un coup d'œil une année mal tapée (2014 pour 2024). */
function Duration({ value, today }: { value: SubscriptionValue; today: string }) {
  const end = value.endDate ?? today;
  if (!value.startDate || !end || end < value.startDate) return null;
  return (
    <p className="text-[13px] text-muted tabular-nums">
      {value.endDate === null ? "En cours depuis " : "Durée : "}
      <span className="font-medium text-ink">{formatDuration(value.startDate, end)}</span>
    </p>
  );
}

/** Contrat souscrit (avec dates) ou simple offre à comparer. */
export function SubscriptionFields({
  value,
  onChange,
}: {
  value: SubscriptionValue | null;
  onChange: (v: SubscriptionValue | null) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" className="flex gap-1 rounded-[10px] bg-chip p-[3px]">
        {[
          { on: true, label: "Contrat souscrit" },
          { on: false, label: "Offre à comparer" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={(value !== null) === o.on}
            onClick={() => onChange(o.on ? (value ?? { startDate: today, endDate: null }) : null)}
            className={`flex-1 rounded-[8px] px-2 py-2 text-[13px] font-medium ${
              (value !== null) === o.on ? "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : ""
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {value && (
        <div className="flex flex-col gap-3">
          <label className={labelClass}>
            Début du contrat
            <input
              type="date"
              value={value.startDate}
              onChange={(e) => onChange({ ...value, startDate: e.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={value.endDate === null}
              onChange={(e) => onChange({ ...value, endDate: e.target.checked ? null : today })}
              className="size-4 accent-[var(--color-grid)]"
            />
            Toujours en cours
          </label>
          {value.endDate !== null && (
            <label className={labelClass}>
              Résilié le (dernier jour du contrat)
              <input
                type="date"
                value={value.endDate}
                onChange={(e) => onChange({ ...value, endDate: e.target.value || null })}
                className={inputClass}
              />
            </label>
          )}
          <Duration value={value} today={today} />
          <p className="text-[11px] text-subtle text-pretty">
            Ne saisissez une fin que si vous avez quitté ce contrat. Une hausse de prix se saisit
            avec « Nouveaux prix », sans clore le contrat ; l&apos;échéance d&apos;engagement
            n&apos;est pas une fin.
          </p>
        </div>
      )}
    </div>
  );
}

export { inputClass, labelClass };
