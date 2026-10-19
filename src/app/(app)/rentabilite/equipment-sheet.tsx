"use client";

import { callAction } from "@/lib/action";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { button, Card, Icon, Notice } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { deleteEquipmentAction, saveEquipmentAction } from "@/server/actions/equipment";
import type { Equipment, EquipmentKind } from "@/server/equipment";

const KIND = {
  solar: { title: "Installation solaire", unit: "kWc", placeholder: "ex. Panneaux en toiture" },
  battery: { title: "Batterie", unit: "kWh", placeholder: "ex. Batterie du garage" },
} as const;

const inputClass =
  "h-10 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[14px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30 tabular-nums";
const labelClass = "flex flex-col gap-1.5 text-xs text-muted";
const toNumber = (t: string) => Number(t.replace(",", ".").trim() || "NaN");
const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** Feuille « Modifier l'équipement » : libellé libre, capacité, date d'installation, coût. */
function EquipmentForm({
  kind,
  initial,
  onDone,
}: {
  kind: EquipmentKind;
  initial: Equipment | null;
  onDone: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [capacity, setCapacity] = useState(
    initial?.capacity == null ? "" : String(initial.capacity).replace(".", ","),
  );
  const [installedOn, setInstalledOn] = useState(initial?.installedOn ?? "");
  const [cost, setCost] = useState(initial ? String(initial.costEur).replace(".", ",") : "");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      const res = await callAction(() =>
        saveEquipmentAction(kind, {
          label,
          capacity: capacity.trim() === "" ? null : toNumber(capacity),
          installedOn,
          costEur: toNumber(cost),
        }),
      );
      if (res.ok) onDone();
      else setErrors(res.errors);
    });
  return (
    <div className="flex flex-col gap-3 rounded-control bg-bg p-3">
      <h3 className="text-sm font-semibold">
        {initial ? "Modifier l'équipement" : "Renseigner l'équipement"}
      </h3>
      <label className={labelClass}>
        Libellé
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={KIND[kind].placeholder}
          className={inputClass}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={labelClass}>
          Capacité ({KIND[kind].unit})
          <input
            inputMode="decimal"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="facultatif"
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Coût TTC (€)
          <input
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className={`${labelClass} col-span-2`}>
          Date d&apos;installation
          <input
            type="date"
            value={installedOn}
            onChange={(e) => setInstalledOn(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
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

/** Carte d'un équipement ; `children` reçoit son amortissement. */
export function EquipmentCard({
  kind,
  item,
  children,
}: {
  kind: EquipmentKind;
  item: Equipment | null;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const done = () => {
    setEditing(false);
    router.refresh();
  };
  return (
    <Card
      icon={kind === "solar" ? "sun" : "bolt"}
      title={item?.label ?? KIND[kind].title}
      // Coût et capacité en ligne de contexte : le coût est repris dans « X € économisés sur
      // Y € », l'amortissement reste ce qu'on lit d'abord.
      description={
        item
          ? [
              KIND[kind].title,
              item.capacity !== null && `${formatNumber(item.capacity, 2)} ${KIND[kind].unit}`,
              `installée le ${fmtDate(item.installedOn)}`,
            ]
              .filter(Boolean)
              .join(" · ")
          : KIND[kind].title
      }
      actions={
        item &&
        !editing && (
          <>
            <button
              type="button"
              className={button.icon}
              aria-label={`Modifier « ${item.label} »`}
              title="Modifier l'équipement"
              onClick={() => setEditing(true)}
            >
              <Icon name="edit" />
            </button>
            <button
              type="button"
              disabled={pending}
              className={button.iconDanger}
              aria-label={`Supprimer « ${item.label} »`}
              title="Supprimer la fiche"
              onClick={() => {
                if (
                  !confirm(
                    `Supprimer la fiche « ${item.label} » ? Les données d'énergie sont conservées.`,
                  )
                )
                  return;
                startTransition(async () => {
                  await deleteEquipmentAction(kind);
                  router.refresh();
                });
              }}
            >
              <Icon name="trash" />
            </button>
          </>
        )
      }
    >
      {editing ? (
        <EquipmentForm kind={kind} initial={item} onDone={done} />
      ) : item ? (
        children
      ) : (
        <Notice
          tone="info"
          title="Équipement à renseigner :"
          action={
            <button type="button" onClick={() => setEditing(true)} className={button.primary}>
              Renseigner l&apos;équipement
            </button>
          }
        >
          indiquez son coût et sa date d&apos;installation pour calculer son amortissement.
        </Notice>
      )}
    </Card>
  );
}
