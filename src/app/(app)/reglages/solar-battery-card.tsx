"use client";

import { callAction } from "@/lib/action";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { button, Card, SwitchRow } from "@/components/ui";
import { updateSolarBatterySettingsAction } from "@/server/actions/equipment";

interface Settings {
  exportEnabled: boolean;
  exportPriceEurKwh: number;
  batteryGridCharging: boolean;
}

const inputClass =
  "h-10 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-right text-[14px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30 tabular-nums";

/** Revente du surplus et charge de la batterie depuis le réseau (calculs de rentabilité). */
export function SolarBatteryCard({
  initial,
  solar,
  battery,
}: {
  initial: Settings;
  solar: boolean;
  battery: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [price, setPrice] = useState(String(initial.exportPriceEurKwh || "").replace(".", ","));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const parsedPrice = Number(price.replace(",", ".").trim() || "0");
  const dirty =
    value.exportEnabled !== initial.exportEnabled ||
    value.batteryGridCharging !== initial.batteryGridCharging ||
    (value.exportEnabled && parsedPrice !== initial.exportPriceEurKwh);

  const save = () =>
    startTransition(async () => {
      const res = await callAction(() =>
        updateSolarBatterySettingsAction({
          ...value,
          exportPriceEurKwh: parsedPrice,
        }),
      );
      if (res.ok) {
        setErrors([]);
        setSaved(true);
        router.refresh();
      } else setErrors(res.errors);
    });

  return (
    <Card
      icon="sun"
      title="Solaire et batterie"
      description="Réglages utilisés pour calculer la rentabilité de vos équipements."
    >
      <div className="flex flex-col">
        {solar && (
          <SwitchRow
            label="Je revends mon surplus"
            description="L'énergie injectée sur le réseau est valorisée au prix de rachat de votre contrat."
            checked={value.exportEnabled}
            onChange={() => {
              setSaved(false);
              setValue((v) => ({ ...v, exportEnabled: !v.exportEnabled }));
            }}
          />
        )}
        {solar && value.exportEnabled && (
          <label className="flex items-center justify-between gap-3 pb-3 text-[13px]">
            <span className="text-muted">Prix de rachat</span>
            <span className="flex w-40 items-center gap-2">
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => {
                  setSaved(false);
                  setPrice(e.target.value);
                }}
                placeholder="0,04"
                className={inputClass}
                aria-label="Prix de rachat en euros par kWh"
              />
              <span className="flex-none text-[11px] text-subtle">€/kWh</span>
            </span>
          </label>
        )}
        {battery && (
          <SwitchRow
            label="Ma batterie se charge aussi depuis le réseau"
            description="Home Assistant doit alors envoyer l'énergie de charge venue du réseau (battery_charge_grid) : elle est déduite des économies."
            checked={value.batteryGridCharging}
            onChange={() => {
              setSaved(false);
              setValue((v) => ({ ...v, batteryGridCharging: !v.batteryGridCharging }));
            }}
          />
        )}
      </div>
      {errors.length > 0 && (
        <p role="alert" className="text-sm text-negative">
          {errors.join(" ; ")}
        </p>
      )}
      {(dirty || saved) && (
        <div className="flex items-center gap-3">
          {dirty && (
            <button type="button" disabled={pending} onClick={save} className={button.primary}>
              Enregistrer
            </button>
          )}
          {saved && !dirty && <span className="text-xs text-positive">Réglages enregistrés.</span>}
        </div>
      )}
    </Card>
  );
}
