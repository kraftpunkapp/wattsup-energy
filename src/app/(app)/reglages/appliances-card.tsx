"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { button, Card, CardFooter, Icon } from "@/components/ui";
import {
  APPLIANCE_ICONS,
  APPLIANCE_PRESETS,
  describeAppliance,
  durationLabel,
  MAX_APPLIANCES,
  type ApplianceIcon,
  type ApplianceInput,
} from "@/domain/forecast/appliances";
import { callAction } from "@/lib/action";
import { deleteApplianceAction, saveApplianceAction } from "@/server/actions/appliances";
import type { ApplianceItem } from "@/server/appliances";

// Réglages › Appareils (T71, SPEC §7.14) : les appareils dont on peut choisir l'heure.
// WattsUp cherche pour chacun le créneau le moins cher (page Prévisions, carte « Demain »).

const ICON_LABELS: Record<ApplianceIcon, string> = {
  washer: "Lavage",
  plug: "Prise",
  droplet: "Eau chaude",
  car: "Véhicule",
  flame: "Chauffage",
  snowflake: "Froid",
  waves: "Piscine",
};
const DURATIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 15);
const HOURS = Array.from({ length: 24 }, (_, h) => h);

const inputClass =
  "h-10 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[13px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30";
const labelClass = "flex flex-col gap-1.5 text-xs text-muted";

type Draft = Omit<ApplianceInput, "powerKw"> & { powerKw: string };
const toDraft = (a: ApplianceInput): Draft => ({
  ...a,
  powerKw: String(a.powerKw).replace(".", ","),
});

function ApplianceForm({
  id,
  initial,
  onDone,
}: {
  id: string | null;
  initial: ApplianceInput;
  onDone: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState<Draft>(toDraft(initial));
  const [anytime, setAnytime] = useState(initial.allowedFrom === initial.allowedTo);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof Draft>(k: K, value: Draft[K]) => setV((x) => ({ ...x, [k]: value }));
  const save = () =>
    startTransition(async () => {
      const input = anytime ? { ...v, allowedFrom: 0, allowedTo: 0 } : v;
      const res = await callAction(() => saveApplianceAction(id, input));
      if (!res.ok) return setErrors(res.errors);
      onDone();
      router.refresh();
    });
  return (
    <form
      className="flex flex-col gap-3 rounded-control bg-bg p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2">
        <label className={labelClass}>
          Nom
          <input
            value={v.name}
            onChange={(e) => set("name", e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Icône
          <select
            value={v.icon}
            onChange={(e) => set("icon", e.target.value as ApplianceIcon)}
            className={inputClass}
          >
            {APPLIANCE_ICONS.map((i) => (
              <option key={i} value={i}>
                {ICON_LABELS[i]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Puissance (kW)
          <input
            inputMode="decimal"
            value={v.powerKw}
            onChange={(e) => set("powerKw", e.target.value)}
            className={`${inputClass} tabular-nums`}
          />
        </label>
        <label className={labelClass}>
          Durée d&apos;un cycle
          <select
            value={v.durationMin}
            onChange={(e) => set("durationMin", Number(e.target.value))}
            className={inputClass}
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {durationLabel(d)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={anytime} onChange={(e) => setAnytime(e.target.checked)} />À
        toute heure, de jour comme de nuit
      </label>
      {!anytime && (
        <div className="flex flex-wrap items-end gap-2">
          <label className={labelClass}>
            Entre
            <select
              value={v.allowedFrom}
              onChange={(e) => set("allowedFrom", Number(e.target.value))}
              className={inputClass}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            et
            <select
              value={v.allowedTo}
              onChange={(e) => set("allowedTo", Number(e.target.value))}
              className={inputClass}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} h
                </option>
              ))}
            </select>
          </label>
          <p className="pb-2.5 text-[11px] text-subtle">Par exemple 8 h – 22 h pour le bruit.</p>
        </div>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-sm text-negative">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={button.primary}>
          Enregistrer
        </button>
        <button type="button" onClick={onDone} className="h-9 px-2 text-xs text-muted">
          Annuler
        </button>
      </div>
    </form>
  );
}

export function AppliancesCard({ appliances }: { appliances: ApplianceItem[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<{ id: string | null; initial: ApplianceInput } | null>(
    null,
  );
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const names = new Set(appliances.map((a) => a.name));
  const suggestions = APPLIANCE_PRESETS.filter((p) => !names.has(p.name));
  const full = appliances.length >= MAX_APPLIANCES;
  const remove = (a: ApplianceItem) => {
    if (!confirm(`Retirer « ${a.name} » ?`)) return;
    startTransition(async () => {
      const res = await callAction(() => deleteApplianceAction(a.id));
      setErrors(res.ok ? [] : res.errors);
      router.refresh();
    });
  };
  const done = () => {
    setEditing(null);
    setAdding(false);
  };

  return (
    <Card
      icon="plug"
      title="Appareils à décaler"
      description="Ceux dont vous pouvez choisir l'heure. WattsUp cherche pour chacun le créneau le moins cher de demain, d'après vos prévisions (page Prévisions)."
    >
      {appliances.length === 0 && !editing && (
        <p className="text-[13px] text-muted">
          Aucun appareil pour l&apos;instant : ajoutez ceux de la liste ci-dessous, puis ajustez
          leur puissance et leur durée.
        </p>
      )}
      {appliances.length > 0 && (
        <ul className="flex flex-col divide-y divide-track">
          {appliances.map((a) =>
            editing?.id === a.id ? (
              <li key={a.id} className="py-2">
                <ApplianceForm id={a.id} initial={a} onDone={done} />
              </li>
            ) : (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <span className="flex size-9 flex-none items-center justify-center rounded-[10px] bg-bg text-ink-soft">
                  <Icon name={a.icon} size={18} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[13px] font-medium">{a.name}</span>
                  <span className="text-[11px] text-muted tabular-nums">
                    {describeAppliance(a)}
                  </span>
                </span>
                <button
                  type="button"
                  className={button.icon}
                  aria-label={`Modifier « ${a.name} »`}
                  title="Modifier"
                  onClick={() => setEditing({ id: a.id, initial: a })}
                >
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className={button.iconDanger}
                  aria-label={`Retirer « ${a.name} »`}
                  title="Retirer"
                  onClick={() => remove(a)}
                >
                  <Icon name="trash" />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {errors.length > 0 && (
        <p role="alert" className="text-sm text-negative">
          {errors.join(" ")}
        </p>
      )}
      {editing?.id === null && <ApplianceForm id={null} initial={editing.initial} onDone={done} />}
      {!editing && !full && (
        <CardFooter>
          {adding || appliances.length === 0 ? (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className={button.secondary}
                  onClick={() => setEditing({ id: null, initial: p })}
                >
                  <Icon name={p.icon} size={14} />
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                className={button.secondary}
                onClick={() =>
                  setEditing({
                    id: null,
                    initial: {
                      name: "",
                      icon: "plug",
                      powerKw: 1,
                      durationMin: 60,
                      allowedFrom: 0,
                      allowedTo: 0,
                    },
                  })
                }
              >
                <Icon name="plus" size={14} />
                Autre appareil
              </button>
            </div>
          ) : (
            <button type="button" className={button.secondary} onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} />
              Ajouter un appareil
            </button>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
