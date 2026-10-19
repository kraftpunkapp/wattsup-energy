"use client";

import { callAction } from "@/lib/action";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Badge, button, Card, Icon, type IconName } from "@/components/ui";
import {
  toBaseQty,
  type Fuel,
  type FuelEventType,
  type FuelSettings,
  type FuelUnit,
} from "@/domain/heating/fuel";
import { deleteFuelEventAction, updateFuelEventAction } from "@/server/actions/fuel";
import { EVENT_LABELS, FUEL_LABELS, formatFuelQty, UNIT_NAMES } from "./labels";
import { PastConsumptionForm } from "./past-consumption-form";

export interface LogItem {
  id: string;
  fuel: Fuel;
  type: FuelEventType;
  /** ISO. */
  at: string;
  qty: number;
  unit: FuelUnit;
  priceEur: number | null;
}

const ICONS: Record<FuelEventType, IconName> = {
  consumption: "flame",
  purchase: "plus",
  stock_snapshot: "check",
};

const inputClass =
  "h-10 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[14px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30 tabular-nums";
const labelClass = "flex flex-col gap-1.5 text-xs text-muted";
const toNumber = (text: string) => Number(text.replace(",", ".").trim() || "NaN");
const eur = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function EditRow({
  item,
  timezone,
  onDone,
}: {
  item: LogItem;
  timezone: string;
  onDone: () => void;
}) {
  const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date(item.at),
  );
  const [qty, setQty] = useState(String(item.qty).replace(".", ","));
  const [price, setPrice] = useState(
    item.priceEur === null ? "" : String(item.priceEur).replace(".", ","),
  );
  const [date, setDate] = useState(localDay);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      const res = await callAction(() =>
        updateFuelEventAction(item.id, {
          qty: toNumber(qty),
          unit: item.unit,
          priceEur: item.type === "purchase" && price.trim() !== "" ? toNumber(price) : null,
          // Une consommation ou un relevé gardent leur heure ; un achat se date au jour.
          date: item.type === "purchase" && date !== localDay ? date : null,
        }),
      );
      if (res.ok) onDone();
      else setErrors(res.errors);
    });
  return (
    <li className="flex flex-col gap-3 rounded-control bg-bg p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className={labelClass}>
          Quantité ({UNIT_NAMES[item.unit]})
          <input
            inputMode="decimal"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={inputClass}
          />
        </label>
        {item.type === "purchase" && (
          <>
            <label className={labelClass}>
              Prix total (€)
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
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
          </>
        )}
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
    </li>
  );
}

/** Prix unitaire d'un achat : par sac (granulés) ou par stère (bois), null sans prix. */
function unitPrice(item: LogItem, settings: FuelSettings): string | null {
  if (item.priceEur === null) return null;
  const base = toBaseQty(item, settings);
  const units = item.fuel === "pellet" ? base / settings.pelletBagKg : base;
  if (units <= 0) return null;
  return `${eur(item.priceEur / units)} €/${item.fuel === "pellet" ? "sac" : "stère"}`;
}

/** Journal des 20 derniers achats, relevés et consommations. */
export function FuelLog({
  items,
  timezone,
  fuels,
  currentMonth,
  settings,
}: {
  items: LogItem[];
  timezone: string;
  /** Combustibles actifs ; s'il y en a deux, on précise celui de chaque ligne. */
  fuels: readonly Fuel[];
  /** Mois en cours « AAAA-MM » (borne de la consommation passée). */
  currentMonth: string;
  /** Poids du sac et sacs par palette, pour le prix par sac. */
  settings: FuelSettings;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const showFuel = fuels.length > 1;
  // Le lien de la prévision (« Saisir une consommation passée ») ouvre le formulaire.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === "#consommation-passee") setPastOpen(true);
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  // Achats et consommations passées sont datés au jour (midi local) : pas d'heure à
  // afficher ; une consommation passée (le 15 à midi) est le total de son mois.
  const parts = (iso: string) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(iso))
        .map((p) => [p.type, p.value]),
    );
  const atNoon = (iso: string) => {
    const p = parts(iso);
    return p.hour === "12" && p.minute === "00" && p.second === "00";
  };
  const when = (item: LogItem) => {
    const date = new Date(item.at);
    const otherYear = item.at.slice(0, 4) !== currentMonth.slice(0, 4);
    if (item.type === "consumption" && atNoon(item.at) && parts(item.at).day === "15") {
      return `total de ${date.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: timezone })}`;
    }
    const dayOnly = item.type === "purchase" || atNoon(item.at);
    return date.toLocaleString("fr-FR", {
      weekday: "short",
      day: "numeric",
      month: "short",
      // L'année seulement quand elle diffère de l'année en cours.
      year: otherYear ? "numeric" : undefined,
      ...(dayOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
      timeZone: timezone,
    });
  };

  return (
    <Card
      title="Journal des combustibles"
      description="Vos 20 dernières saisies : achats, relevés et consommations."
    >
      {!pastOpen && (
        <button
          type="button"
          onClick={() => setPastOpen(true)}
          className={`${button.secondary} self-start`}
        >
          <Icon name="plus" size={14} />
          Consommation passée
        </button>
      )}
      {pastOpen && (
        <PastConsumptionForm
          fuels={fuels}
          currentMonth={currentMonth}
          onClose={() => {
            setPastOpen(false);
            if (window.location.hash)
              history.replaceState(null, "", window.location.pathname + window.location.search);
          }}
        />
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted">
          Rien pour l&apos;instant : commencez par un achat ou un relevé de stock.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) =>
            editing === item.id ? (
              <EditRow
                key={item.id}
                item={item}
                timezone={timezone}
                onDone={() => {
                  setEditing(null);
                  router.refresh();
                }}
              />
            ) : (
              <li
                key={item.id}
                className="flex items-center gap-3 border-t border-track py-2.5 first:border-t-0"
              >
                <span className="flex size-8 flex-none items-center justify-center rounded-[8px] bg-bg text-muted">
                  <Icon name={ICONS[item.type]} size={15} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-medium">{EVENT_LABELS[item.type]}</span>
                    <span className="tabular-nums">{formatFuelQty(item.qty, item.unit)}</span>
                    {item.priceEur !== null && (
                      <span className="text-muted tabular-nums">
                        · {eur(item.priceEur)} €
                        {unitPrice(item, settings) && <> · {unitPrice(item, settings)}</>}
                      </span>
                    )}
                    {showFuel && <Badge>{FUEL_LABELS[item.fuel]}</Badge>}
                  </span>
                  <span className="text-[11px] text-subtle">{when(item)}</span>
                </div>
                <button
                  type="button"
                  className={button.icon}
                  aria-label={`Modifier : ${EVENT_LABELS[item.type]}, ${when(item)}`}
                  title="Modifier"
                  onClick={() => setEditing(item.id)}
                >
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className={button.iconDanger}
                  aria-label={`Supprimer : ${EVENT_LABELS[item.type]}, ${when(item)}`}
                  title="Supprimer"
                  onClick={() => {
                    if (!confirm("Supprimer cet événement ? Le stock sera recalculé.")) return;
                    startTransition(async () => {
                      await deleteFuelEventAction(item.id);
                      router.refresh();
                    });
                  }}
                >
                  <Icon name="trash" />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </Card>
  );
}
