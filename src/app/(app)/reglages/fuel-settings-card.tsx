"use client";

import { callAction } from "@/lib/action";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { button, Card } from "@/components/ui";
import type { FuelSettings } from "@/server/settings";
import { updateFuelSettingsAction } from "@/server/actions/settings";

const inputClass =
  "h-10 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-right text-[14px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30 tabular-nums";
const labelClass = "flex flex-col gap-1.5 text-xs text-muted";
const toNumber = (t: string) => Number(t.replace(",", ".").trim() || "NaN");
const text = (n: number) => String(n).replace(".", ",");

/** « JJ/MM » saisi ou affiché, « MM-JJ » stocké. */
const toMonthDay = (ddmm: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(ddmm.trim());
  return m ? `${(m[2] ?? "").padStart(2, "0")}-${(m[1] ?? "").padStart(2, "0")}` : ddmm;
};
const toDayMonth = (mmdd: string) => `${mmdd.slice(3, 5)}/${mmdd.slice(0, 2)}`;

function Field({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: string;
  unit?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={labelClass}>
      {label}
      <span className="flex items-center gap-2">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
        {unit && <span className="w-14 flex-none text-[11px] text-subtle">{unit}</span>}
      </span>
    </label>
  );
}

/** Poids du sac, sacs par palette, saison de chauffe, équivalences kWh. */
export function FuelSettingsCard({
  initial,
  pellet,
  wood,
}: {
  initial: FuelSettings;
  pellet: boolean;
  wood: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState({
    bagKg: text(initial.pelletBagKg),
    perPallet: text(initial.pelletBagsPerPallet),
    from: toDayMonth(initial.heatingSeason.from),
    to: toDayMonth(initial.heatingSeason.to),
    pelletKwh: text(initial.kwhFactors.pelletPerKg),
    woodKwh: text(initial.kwhFactors.woodPerStere),
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<typeof v>) => {
    setSaved(false);
    setV((x) => ({ ...x, ...patch }));
  };
  const save = () =>
    startTransition(async () => {
      const res = await callAction(() =>
        updateFuelSettingsAction({
          pelletBagKg: toNumber(v.bagKg),
          pelletBagsPerPallet: toNumber(v.perPallet),
          heatingSeason: { from: toMonthDay(v.from), to: toMonthDay(v.to) },
          kwhFactors: { pelletPerKg: toNumber(v.pelletKwh), woodPerStere: toNumber(v.woodKwh) },
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
      icon="flame"
      title="Combustibles"
      description="Utilisés pour le stock, le coût de chauffe et la prévision de réapprovisionnement."
    >
      <div className="grid grid-cols-2 gap-3">
        {pellet && (
          <>
            <Field
              label="Poids d'un sac"
              value={v.bagKg}
              unit="kg"
              onChange={(bagKg) => set({ bagKg })}
            />
            <Field
              label="Sacs par palette"
              value={v.perPallet}
              onChange={(perPallet) => set({ perPallet })}
            />
            <Field
              label="Énergie des granulés"
              value={v.pelletKwh}
              unit="kWh/kg"
              onChange={(pelletKwh) => set({ pelletKwh })}
            />
          </>
        )}
        {wood && (
          <Field
            label="Énergie du bois"
            value={v.woodKwh}
            unit="kWh/stère"
            onChange={(woodKwh) => set({ woodKwh })}
          />
        )}
        <Field label="Début de saison (JJ/MM)" value={v.from} onChange={(from) => set({ from })} />
        <Field label="Fin de saison (JJ/MM)" value={v.to} onChange={(to) => set({ to })} />
      </div>
      <p className="text-[11px] text-subtle text-pretty">
        Par défaut : 4,8 kWh par kg de granulés, 1 800 kWh par stère de bois sec, saison du 1er
        octobre au 30 avril.
      </p>
      {errors.length > 0 && (
        <p role="alert" className="text-sm text-negative">
          {errors.join(" ; ")}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={save} className={button.primary}>
          Enregistrer
        </button>
        {saved && <span className="text-xs text-positive">Réglages enregistrés.</span>}
      </div>
    </Card>
  );
}
