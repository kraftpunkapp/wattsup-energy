"use client";

import { callAction } from "@/lib/action";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, button, Card, Icon, Notice } from "@/components/ui";
import { metricLabel } from "@/domain/ingest/metrics";
import { formatNumber } from "@/lib/format";
import { settingsHref } from "@/lib/settings-tabs";
import {
  deleteRangeAction,
  deleteValueAction,
  rangeSummaryAction,
  setValueAction,
} from "@/server/actions/energy-data";

// Onglet Données (SPEC §7.11) : valeurs suspectes, un jour d'un compteur, suppression
// d'une plage. Une valeur corrigée passe en « manuel » et n'est plus écrasée.

export interface ValueItem {
  metric: string;
  /** ISO. */
  start: string;
  granularity: "hour" | "day";
  tariffSlot: "all" | "hp" | "hc";
  kwh: number;
  source: "ha" | "csv" | "manual";
}

const SOURCE = {
  ha: { label: "HA", tone: "neutral" },
  csv: { label: "CSV", tone: "neutral" },
  manual: { label: "Manuel", tone: "warning" },
} as const;

const inputClass =
  "h-10 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[14px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30 tabular-nums";
const labelClass = "flex flex-col gap-1.5 text-xs text-muted";
const toNumber = (text: string) => Number(text.replace(",", ".").trim() || "NaN");

/** « 10 mars 2026, 09:00 » (heure) ou « 10 mars 2026 · HP » (jour). */
function when(item: ValueItem, timezone: string, withDate = true) {
  const d = new Date(item.start);
  if (item.granularity === "day") {
    const date = d.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: timezone,
    });
    return item.tariffSlot === "all" ? date : `${date} · ${item.tariffSlot.toUpperCase()}`;
  }
  return d.toLocaleString("fr-FR", {
    ...(withDate ? { day: "numeric", month: "short", year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });
}

function Errors({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <p role="alert" className="text-sm text-negative">
      {errors.join(" ; ")}
    </p>
  );
}

/** Une valeur : lecture, correction en place, suppression. */
function ValueRow({ item, title, sub }: { item: ValueItem; title: string; sub?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(item.kwh).replace(".", ","));
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const key = {
    metric: item.metric,
    start: item.start,
    granularity: item.granularity,
    tariffSlot: item.tariffSlot,
  };
  const save = () =>
    startTransition(async () => {
      const res = await callAction(() => setValueAction(key, toNumber(text)));
      if (res.ok) {
        setEditing(false);
        setErrors([]);
      } else setErrors(res.errors);
    });
  const remove = () => {
    if (!confirm(`Supprimer la valeur « ${title} » ?`)) return;
    startTransition(async () => {
      const res = await callAction(() => deleteValueAction(key));
      if (!res.ok) setErrors(res.errors);
    });
  };
  return (
    <li className="flex flex-col gap-2 border-t border-track py-2.5 first:border-t-0">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] tabular-nums">{title}</span>
          {sub && <span className="truncate text-[11px] text-subtle">{sub}</span>}
        </div>
        <span className="flex flex-none items-center gap-2 text-[13px] tabular-nums">
          <span className="font-semibold">{formatNumber(item.kwh, item.kwh < 10 ? 3 : 1)} kWh</span>
          <Badge tone={SOURCE[item.source].tone}>{SOURCE[item.source].label}</Badge>
        </span>
        {!editing && (
          <>
            <button
              type="button"
              className={button.icon}
              aria-label={`Corriger la valeur « ${title} »`}
              title="Corriger"
              onClick={() => setEditing(true)}
            >
              <Icon name="edit" />
            </button>
            <button
              type="button"
              disabled={pending}
              className={button.iconDanger}
              aria-label={`Supprimer la valeur « ${title} »`}
              title="Supprimer"
              onClick={remove}
            >
              <Icon name="trash" />
            </button>
          </>
        )}
      </div>
      {/* Correction sur sa propre ligne : lisible même sur un écran étroit. */}
      {editing && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            Nouvelle valeur
            <input
              aria-label={`Nouvelle valeur pour ${title}, en kWh`}
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={`${inputClass} w-28`}
            />
            kWh
          </label>
          <button type="button" disabled={pending} onClick={save} className={button.primary}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className={button.secondary}>
            Annuler
          </button>
        </div>
      )}
      <Errors errors={errors} />
    </li>
  );
}

/** Valeurs au-delà du seuil de plausibilité de leur compteur. */
export function SuspectCard({
  items,
  names,
  timezone,
}: {
  items: ValueItem[];
  names: Record<string, string>;
  timezone: string;
}) {
  return (
    <Card
      icon="bolt"
      title="Valeurs suspectes"
      badges={
        items.length > 0 ? (
          <Badge tone="warning">{items.length}</Badge>
        ) : (
          <Badge tone="positive">Aucune</Badge>
        )
      }
      description="Au-delà du maximum plausible pour le compteur (par exemple un saut de compteur). Corrigez ou supprimez-les."
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted">Rien d&apos;anormal dans vos données.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((v) => (
            <ValueRow
              key={`${v.metric}|${v.start}|${v.granularity}|${v.tariffSlot}`}
              item={v}
              title={metricLabel(v.metric, names, true)}
              sub={when(v, timezone)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function MetricSelect({
  metrics,
  names,
  value,
  onChange,
  all = false,
}: {
  metrics: string[];
  names: Record<string, string>;
  value: string;
  onChange: (v: string) => void;
  all?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {all && <option value="">Tous les compteurs</option>}
      {metrics.map((m) => (
        <option key={m} value={m}>
          {metricLabel(m, names, true)}
        </option>
      ))}
    </select>
  );
}

/** Un jour, un compteur : ses valeurs (24 heures, ou le total du jour), corrigibles. */
export function DayCard({
  metrics,
  names,
  metric,
  day,
  items,
  timezone,
}: {
  metrics: string[];
  names: Record<string, string>;
  metric: string;
  day: string;
  items: ValueItem[];
  timezone: string;
}) {
  const router = useRouter();
  const [m, setM] = useState(metric);
  const [d, setD] = useState(day);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const total = items.reduce((a, v) => a + v.kwh, 0);
  const show = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`${settingsHref("donnees")}&compteur=${encodeURIComponent(m)}&jour=${d}`, {
      scroll: false,
    });
  };
  const deleteDay = () => {
    if (!confirm(`Supprimer les ${items.length} valeurs de ce jour pour ce compteur ?`)) return;
    startTransition(async () => {
      const res = await callAction(() => deleteRangeAction({ metric, from: day, to: day }));
      if (!res.ok) setErrors(res.errors);
    });
  };
  return (
    <Card
      icon="sliders"
      title="Un jour, un compteur"
      description="Pour vérifier ou corriger les valeurs d'une journée."
    >
      <form
        onSubmit={show}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] items-end gap-2"
      >
        <label className={labelClass}>
          Compteur
          <MetricSelect metrics={metrics} names={names} value={m} onChange={setM} />
        </label>
        <label className={labelClass}>
          Jour
          <input
            type="date"
            value={d}
            onChange={(e) => setD(e.target.value)}
            className={inputClass}
          />
        </label>
        <button type="submit" className={`${button.secondary} h-10`}>
          Afficher
        </button>
      </form>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Aucune valeur pour ce compteur ce jour-là.</p>
      ) : (
        <>
          <p className="text-[13px] text-muted tabular-nums">
            {items.length} valeur{items.length > 1 ? "s" : ""} · total{" "}
            <span className="font-semibold text-ink">
              {formatNumber(total, total < 10 ? 2 : 1)} kWh
            </span>
          </p>
          <ul className="flex flex-col">
            {items.map((v) => (
              <ValueRow
                key={`${v.start}|${v.granularity}|${v.tariffSlot}`}
                item={v}
                title={v.granularity === "hour" ? when(v, timezone, false) : when(v, timezone)}
              />
            ))}
          </ul>
          <button
            type="button"
            disabled={pending}
            onClick={deleteDay}
            className="self-start text-xs text-negative hover:text-ink disabled:opacity-60"
          >
            Supprimer toute la journée pour ce compteur
          </button>
        </>
      )}
      <Errors errors={errors} />
    </Card>
  );
}

/** Supprimer une plage : aperçu (nombre et énergie), puis suppression confirmée. */
export function RangeCard({
  metrics,
  names,
  today,
}: {
  metrics: string[];
  names: Record<string, string>;
  today: string;
}) {
  const [m, setM] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [preview, setPreview] = useState<{ count: number; kwh: number } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const input = { metric: m || null, from, to };
  const reset = () => {
    setPreview(null);
    setDone(null);
  };
  const look = () =>
    startTransition(async () => {
      const res = await callAction(() => rangeSummaryAction(input));
      if (res.ok) {
        setErrors([]);
        setPreview({ count: res.count, kwh: res.kwh });
      } else setErrors(res.errors);
    });
  const remove = () => {
    if (!preview || !confirm(`Supprimer définitivement ${preview.count} valeurs ?`)) return;
    startTransition(async () => {
      const res = await callAction(() => deleteRangeAction(input));
      if (res.ok) {
        setPreview(null);
        setDone(res.deleted);
      } else setErrors(res.errors);
    });
  };
  return (
    <Card
      icon="trash"
      title="Supprimer une plage"
      description="Par exemple une période où un capteur envoyait n'importe quoi. Vous pourrez ensuite la réimporter depuis Home Assistant ou un CSV."
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-2">
        <label className={labelClass}>
          Compteur
          <MetricSelect
            metrics={metrics}
            names={names}
            value={m}
            onChange={(v) => {
              setM(v);
              reset();
            }}
            all
          />
        </label>
        <label className={labelClass}>
          Du
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              reset();
            }}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Au (inclus)
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              reset();
            }}
            className={inputClass}
          />
        </label>
      </div>
      {preview ? (
        preview.count === 0 ? (
          <p className="text-sm text-muted">Aucune valeur sur cette plage.</p>
        ) : (
          <Notice
            title={`${formatNumber(preview.count)} valeurs, ${formatNumber(preview.kwh, 1)} kWh :`}
            action={
              <button
                type="button"
                disabled={pending}
                onClick={remove}
                className={`${button.primary} bg-negative`}
              >
                {pending ? "Suppression…" : `Supprimer ${formatNumber(preview.count)} valeurs`}
              </button>
            }
          >
            elles seront supprimées définitivement.
          </Notice>
        )
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={look}
          className={`${button.secondary} self-start`}
        >
          {pending ? "Calcul…" : "Voir ce qui sera supprimé"}
        </button>
      )}
      {done !== null && (
        <p role="status" className="text-sm text-positive">
          {formatNumber(done)} valeur{done > 1 ? "s" : ""} supprimée{done > 1 ? "s" : ""}.
        </p>
      )}
      <Errors errors={errors} />
    </Card>
  );
}
