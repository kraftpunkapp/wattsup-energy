"use client";

import { callAction } from "@/lib/action";
import { useState, useTransition } from "react";
import { button, Card, Figures, Notice, SwitchRow } from "@/components/ui";
import { formatEur, formatEurFromCents, formatNumber, formatPercent } from "@/lib/format";
import { simulateAction } from "@/server/actions/simulation";
import type { SimulationView } from "@/server/simulation";

// « Et si… ? » (T45) : une batterie et/ou des panneaux en plus, rejoués heure par heure sur
// les 12 derniers mois du foyer, au prix du contrat actuel. Réponse en grand (économie par
// an), détail dessous, hypothèses en pied.

const inputClass =
  "h-9 w-full rounded-[8px] border border-border-strong bg-surface px-2.5 text-[14px] tabular-nums outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30";
const labelClass = "flex min-w-0 flex-col gap-1 text-xs text-muted";
const toNumber = (t: string) => Number(t.replace(",", ".").trim() || "NaN");
const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const UNAVAILABLE: Record<Extract<SimulationView, { status: "unavailable" }>["reason"], string> = {
  "no-contract": "il faut un contrat en cours pour chiffrer l'électricité achetée.",
  "no-data":
    "il faut au moins 30 jours de données heure par heure (envois horaires ou import CSV horaire).",
  "no-solar-capacity":
    "indiquez la puissance (kWc) de votre installation solaire dans sa carte ci-dessus.",
};

function Field({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={labelClass}>
      {label} ({unit})
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </label>
  );
}

export function SimulatorCard({
  hasBattery,
  solarKwc,
  exportEnabled,
}: {
  /** Le foyer a déjà une batterie : la simulée s'ajoute. */
  hasBattery: boolean;
  /** Puissance installée connue (kWc) ; null : panneaux en plus impossibles à simuler. */
  solarKwc: number | null;
  exportEnabled: boolean;
}) {
  const [battery, setBattery] = useState(true);
  const [capacity, setCapacity] = useState("5");
  const [power, setPower] = useState("2,5");
  const [batteryCost, setBatteryCost] = useState("3500");
  const [panels, setPanels] = useState(false);
  const [kwc, setKwc] = useState("2");
  const [panelsCost, setPanelsCost] = useState("2500");
  const [view, setView] = useState<SimulationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const res = await callAction(() =>
        simulateAction({
          battery: battery
            ? {
                capacityKwh: toNumber(capacity),
                powerKw: toNumber(power),
                costEur: toNumber(batteryCost),
              }
            : null,
          panels: panels ? { kwc: toNumber(kwc), costEur: toNumber(panelsCost) } : null,
        }),
      );
      if (res.ok) {
        setView(res.view);
        setError(null);
      } else {
        setView(null);
        setError("error" in res ? res.error : (res.errors[0] ?? null));
      }
    });

  const ok = view?.status === "ok" ? view : null;
  return (
    <Card
      icon="bolt"
      title="Et si… ?"
      description="Une batterie ou des panneaux en plus, rejoués heure par heure sur vos 12 derniers mois, au prix de votre contrat actuel."
    >
      <div className="flex flex-col">
        <SwitchRow
          label={hasBattery ? "Une batterie de plus" : "Une batterie"}
          description="Elle se charge du surplus qui part au réseau et le restitue quand vous achetez."
          checked={battery}
          onChange={() => setBattery(!battery)}
        />
        {battery && (
          <div className="grid grid-cols-3 items-end gap-2 pb-3">
            <Field label="Capacité" unit="kWh" value={capacity} onChange={setCapacity} />
            <Field label="Puissance" unit="kW" value={power} onChange={setPower} />
            <Field label="Prix" unit="€" value={batteryCost} onChange={setBatteryCost} />
          </div>
        )}
        <SwitchRow
          label="Des panneaux en plus"
          description={
            solarKwc
              ? `Production proportionnelle à la vôtre (${formatNumber(solarKwc, 1)} kWc aujourd'hui).`
              : "Indiquez d'abord la puissance de votre installation dans sa carte."
          }
          checked={panels}
          disabled={!solarKwc}
          onChange={() => setPanels(!panels)}
        />
        {panels && (
          <div className="grid grid-cols-3 items-end gap-2 pb-3">
            <Field label="Ajout" unit="kWc" value={kwc} onChange={setKwc} />
            <Field label="Prix" unit="€" value={panelsCost} onChange={setPanelsCost} />
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={pending || (!battery && !panels)}
        onClick={run}
        className={`${button.primary} self-start`}
      >
        {pending ? "Calcul…" : "Simuler"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      {view?.status === "unavailable" && (
        <Notice tone="info" title="Simulation impossible :">
          {UNAVAILABLE[view.reason]}
        </Notice>
      )}
      {ok && (
        <div role="status" className="flex flex-col gap-3">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span
              className={`text-[32px] leading-none font-semibold tracking-tight tabular-nums ${
                ok.annual.savingsCents > 0 ? "text-positive" : ""
              }`}
            >
              {ok.annual.savingsCents > 0 ? "≈ " : ""}
              {formatEurFromCents(ok.annual.savingsCents, 0)}
            </span>
            <span className="text-[13px] text-muted">d&apos;économie par an</span>
          </p>
          <p className="text-[13px] text-ink-soft text-pretty">
            {ok.paybackYears !== null
              ? `Amorti en ≈ ${formatNumber(ok.paybackYears, ok.paybackYears < 10 ? 1 : 0)} ans pour ${formatEur(ok.costEur)}${
                  battery && ok.paybackYears > 15
                    ? " : plus long que la durée de vie d'une batterie (10 à 15 ans)."
                    : "."
                }`
              : ok.costEur > 0
                ? `Pas d'économie : ${formatEur(ok.costEur)} jamais remboursés.`
                : "Indiquez un prix pour estimer l'amortissement."}
            {ok.selfConsumption.before !== null && ok.selfConsumption.after !== null && (
              <>
                {" "}
                Autoconsommation : {formatPercent(ok.selfConsumption.before)} →{" "}
                <span className="font-semibold text-ink">
                  {formatPercent(ok.selfConsumption.after)}
                </span>{" "}
                de la production.
              </>
            )}
          </p>
          <Figures
            items={[
              {
                label: "Achats évités",
                value: formatNumber(ok.annual.importAvoidedKwh),
                unit: "kWh/an",
              },
              {
                label: exportEnabled ? "Revente" : "Envoyé au réseau",
                value: `${ok.annual.exportChangeKwh > 0 ? "+" : "−"}${formatNumber(Math.abs(ok.annual.exportChangeKwh))}`,
                unit: "kWh/an",
              },
            ]}
          />
          <p className="text-[11px] text-subtle text-pretty">
            Rejoué sur {ok.days} jours de données ({fmtDate(ok.from)} – {fmtDate(ok.to)})
            {ok.days < 365 ? ", ramené à un an" : ""}. Batterie : rendement aller-retour de 90 %,
            vide au départ ; panneaux ajoutés : même orientation que les vôtres.{" "}
            {exportEnabled
              ? "La revente perdue est déduite."
              : "Sans revente, le surplus envoyé au réseau ne rapporte rien."}{" "}
            Estimation : un hiver ou des prix différents changeront le résultat.
          </p>
        </div>
      )}
      {!ok && !view && !error && (
        <p className="text-[11px] text-subtle">Choisissez une option puis « Simuler ».</p>
      )}
    </Card>
  );
}
