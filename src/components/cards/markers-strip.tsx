"use client";

import { callAction } from "@/lib/action";
import { useState, useTransition } from "react";
import { Badge, button, Icon, type IconName } from "@/components/ui";
import {
  MARKER_KINDS,
  MARKER_TEXT_MAX,
  markerDates,
  markersBetween,
  type Marker,
  type MarkerKind,
} from "@/domain/markers";
import type { Period } from "@/domain/overview";
import { deleteMarkerAction, saveMarkerAction } from "@/server/actions/markers";

// Repères de la période, sous le sélecteur : une ligne discrète (rien s'il n'y en a pas),
// dépliable pour lire, modifier ou supprimer ; « + Repère » pour en ajouter un.

const KINDS: Record<Marker["kind"], { label: string; icon: IconName }> = {
  equipment: { label: "Équipement", icon: "plug" },
  maintenance: { label: "Maintenance", icon: "sliders" },
  absence: { label: "Absence", icon: "home" },
  other: { label: "Autre", icon: "pin" },
  contract: { label: "Contrat", icon: "bolt" },
  install: { label: "Mise en service", icon: "sun" },
};

const inputClass =
  "h-10 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[14px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30";
const labelClass = "flex flex-col gap-1.5 text-xs text-muted";

function MarkerForm({
  initial,
  defaultDate,
  onDone,
}: {
  initial: Marker | null;
  defaultDate: string;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<MarkerKind>(
    initial && initial.id ? (initial.kind as MarkerKind) : "equipment",
  );
  const [text, setText] = useState(initial?.text ?? "");
  const [start, setStart] = useState(initial?.startDate ?? defaultDate);
  const [end, setEnd] = useState<string | null>(initial?.endDate ?? null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      const res = await callAction(() =>
        saveMarkerAction(initial?.id ?? null, {
          kind,
          text,
          startDate: start,
          endDate: end,
        }),
      );
      if (res.ok) onDone();
      else setErrors(res.errors);
    });
  return (
    <div className="flex flex-col gap-3 rounded-control bg-bg p-3">
      <div role="radiogroup" aria-label="Type de repère" className="flex flex-wrap gap-1">
        {MARKER_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] ${
              kind === k ? "border-ink bg-surface font-medium" : "border-border text-ink-soft"
            }`}
          >
            <Icon name={KINDS[k].icon} size={14} />
            {KINDS[k].label}
          </button>
        ))}
      </div>
      <label className={labelClass}>
        Ce qui s&apos;est passé
        <input
          value={text}
          maxLength={MARKER_TEXT_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex. : achat d'un sèche-linge, panneaux nettoyés, vacances…"
          className={inputClass}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={labelClass}>
          {end === null ? "Date" : "Du"}
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={inputClass}
          />
        </label>
        {end !== null && (
          <label className={labelClass}>
            Au (inclus)
            <input
              type="date"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value || null)}
              className={inputClass}
            />
          </label>
        )}
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={end !== null}
          onChange={(e) => setEnd(e.target.checked ? start : null)}
          className="size-4 accent-[var(--color-grid)]"
        />
        Sur plusieurs jours
      </label>
      {errors.length > 0 && (
        <p role="alert" className="text-sm text-negative">
          {errors.join(" ; ")}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={save} className={button.primary}>
          Enregistrer
        </button>
        <button type="button" onClick={onDone} className={button.secondary}>
          Annuler
        </button>
      </div>
    </div>
  );
}

export function MarkersStrip({
  markers,
  period,
  today,
}: {
  /** Repères de l'année (saisis et automatiques). */
  markers: Marker[];
  period: Period;
  today: string;
}) {
  const shown = markersBetween(markers, period.from, period.to);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Marker | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  // Nouveau repère : aujourd'hui si la période le contient, sinon son premier jour.
  const defaultDate = today >= period.from && today < period.to ? today : period.from;
  const summary = shown
    .slice(0, 2)
    .map((m) => m.text)
    .join(" · ");

  return (
    <section aria-label="Repères" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        {shown.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="flex size-6 flex-none items-center justify-center rounded-full bg-ink text-bg">
              <Icon name="pin" size={13} />
            </span>
            <span className="min-w-0 truncate">
              <span className="font-medium">
                {shown.length} repère{shown.length > 1 ? "s" : ""}
              </span>
              <span className="text-muted">
                {" "}
                · {summary}
                {shown.length > 2 ? "…" : ""}
              </span>
            </span>
            <span
              className={`flex-none text-muted transition-transform ${open ? "rotate-90" : ""}`}
            >
              <Icon name="chevron" size={14} />
            </span>
          </button>
        )}
        {editing === null && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="flex items-center gap-1 text-[13px] text-ink-soft hover:text-ink"
          >
            <Icon name="plus" size={14} />
            Repère
          </button>
        )}
      </div>

      {editing !== null && (
        <MarkerForm
          initial={editing === "new" ? null : editing}
          defaultDate={defaultDate}
          onDone={() => setEditing(null)}
        />
      )}

      {open && shown.length > 0 && (
        <ul className="flex flex-col rounded-card border border-border bg-surface px-4">
          {shown.map((m) => (
            <li
              key={`${m.id ?? m.kind}-${m.startDate}-${m.text}`}
              className="flex items-center gap-3 border-t border-track py-2.5 first:border-t-0"
            >
              <span className="flex size-8 flex-none items-center justify-center rounded-[8px] bg-bg text-muted">
                <Icon name={KINDS[m.kind].icon} size={15} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13px] text-pretty">{m.text}</span>
                <span className="flex flex-wrap items-center gap-2 text-[11px] text-subtle">
                  {markerDates(m)}
                  {m.id === null && <Badge>automatique</Badge>}
                </span>
              </span>
              {m.id !== null && (
                <>
                  <button
                    type="button"
                    className={button.icon}
                    aria-label={`Modifier le repère « ${m.text} »`}
                    title="Modifier"
                    onClick={() => setEditing(m)}
                  >
                    <Icon name="edit" />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className={button.iconDanger}
                    aria-label={`Supprimer le repère « ${m.text} »`}
                    title="Supprimer"
                    onClick={() => {
                      if (!confirm("Supprimer ce repère ?")) return;
                      const id = m.id;
                      if (id) startTransition(async () => void (await deleteMarkerAction(id)));
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
