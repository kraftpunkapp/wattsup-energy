"use client";

import { callAction } from "@/lib/action";
import { useState, useTransition } from "react";
import { button, DeltaChip, Icon, StatusChip } from "@/components/ui";
import { formatEur, formatEurFromCents, formatNumber, formatPercent } from "@/lib/format";
import { simulateAction } from "@/server/actions/simulation";
import type { SimulationView } from "@/server/simulation";

// « Et si vous investissiez davantage ? » (T45) : une batterie ou des panneaux en plus, rejoués
// heure par heure sur les 12 derniers mois du foyer, au prix du contrat actuel. Trois étapes
// (quel équipement, quelle taille, quel prix), puis la réponse en grand et les hypothèses.

type Choice = "battery" | "panels";

const OPTIONS: Record<
  Choice,
  {
    min: number;
    max: number;
    step: number;
    start: number;
    unit: string;
    unitPrice: number;
    life: string;
    lifeYears: number;
  }
> = {
  // Prix au kWh ou au kWc : repères indicatifs pour préremplir le devis (à remplacer par le sien).
  battery: {
    min: 2,
    max: 15,
    step: 0.5,
    start: 5,
    unit: "kWh",
    unitPrice: 700,
    life: "10 à 15 ans",
    lifeYears: 12,
  },
  panels: {
    min: 0.5,
    max: 6,
    step: 0.5,
    start: 2,
    unit: "kWc",
    unitPrice: 1250,
    life: "25 ans environ",
    lifeYears: 25,
  },
};

const UNAVAILABLE: Record<Extract<SimulationView, { status: "unavailable" }>["reason"], string> = {
  "no-contract": "il faut un contrat en cours pour chiffrer l'électricité achetée.",
  "no-data":
    "il faut au moins 30 jours de données heure par heure (envois horaires ou import CSV horaire).",
  "no-solar-capacity":
    "indiquez la puissance (kWc) de votre installation solaire dans sa carte ci-dessus.",
};

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const toNumber = (t: string) => Number(t.replace(",", ".").trim() || "NaN");

function Choose({
  icon,
  title,
  text,
  on,
  disabled,
  onClick,
}: {
  icon: "bolt" | "sun";
  title: string;
  text: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-16 flex-1 basis-60 items-center gap-3 rounded-control border px-4 py-3 text-left disabled:opacity-50 ${
        on ? "border-2 border-ink bg-surface" : "border border-border-strong bg-bg"
      }`}
    >
      <span
        aria-hidden
        className="flex size-10 flex-none items-center justify-center rounded-control bg-track"
      >
        <Icon name={icon} size={20} />
      </span>
      <span className="flex flex-col">
        <strong className="text-[15px]">{title}</strong>
        <span className="text-[13px] text-ink-soft">{text}</span>
      </span>
      {on && (
        <span aria-hidden className="ml-auto flex-none">
          <Icon name="check" size={18} />
        </span>
      )}
    </button>
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
  const [choice, setChoice] = useState<Choice>("battery");
  const o = OPTIONS[choice];
  const [size, setSize] = useState<Record<Choice, number>>({
    battery: OPTIONS.battery.start,
    panels: OPTIONS.panels.start,
  });
  // Prix : proposé d'après la taille tant que le foyer n'a pas mis son devis.
  const [typed, setTyped] = useState<Record<Choice, string | null>>({
    battery: null,
    panels: null,
  });
  const proposed = Math.round((size[choice] * o.unitPrice) / 50) * 50;
  const price = typed[choice] ?? String(proposed);
  const [view, setView] = useState<SimulationView | null>(null);
  const [asked, setAsked] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const res = await callAction(() =>
        simulateAction({
          battery:
            choice === "battery"
              ? {
                  capacityKwh: size.battery,
                  // Hypothèse : puissance de charge et de décharge = la moitié de la capacité.
                  powerKw: size.battery / 2,
                  costEur: toNumber(price),
                }
              : null,
          panels: choice === "panels" ? { kwc: size.panels, costEur: toNumber(price) } : null,
        }),
      );
      if (res.ok) {
        setView(res.view);
        setAsked(choice);
        setError(null);
      } else {
        setView(null);
        setError("error" in res ? res.error : (res.errors[0] ?? null));
      }
    });

  const ok = view?.status === "ok" && asked ? view : null;
  const life = asked ? OPTIONS[asked] : null;
  const verdict =
    ok && life
      ? ok.paybackYears === null
        ? { tone: "warning" as const, label: "Pas rentable" }
        : ok.paybackYears <= life.lifeYears * 0.7
          ? { tone: "positive" as const, label: "Rentable" }
          : ok.paybackYears <= life.lifeYears
            ? { tone: "soft" as const, label: "Juste rentable" }
            : { tone: "warning" as const, label: "Pas rentable" }
      : null;

  return (
    <section
      aria-labelledby="sim-titre"
      className="flex flex-col gap-5 rounded-card border border-border bg-surface p-6 sm:p-7"
    >
      <div className="flex flex-col gap-1">
        <h2 id="sim-titre" className="text-[15px] font-bold">
          Et si vous investissiez davantage ?
        </h2>
        <p className="text-sm text-muted text-pretty">
          Vos 12 derniers mois rejoués heure par heure avec du matériel en plus, au prix de votre
          contrat actuel.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">1 · Quel équipement ?</h3>
        <div className="flex flex-wrap gap-3">
          <Choose
            icon="bolt"
            title={hasBattery ? "Une batterie de plus" : "Une batterie"}
            text="stocker plus de soleil"
            on={choice === "battery"}
            onClick={() => setChoice("battery")}
          />
          <Choose
            icon="sun"
            title="Des panneaux en plus"
            text={
              solarKwc
                ? `produire davantage (${formatNumber(solarKwc, 1)} kWc aujourd'hui)`
                : "indiquez d'abord la puissance de votre installation"
            }
            on={choice === "panels"}
            disabled={!solarKwc}
            onClick={() => setChoice("panels")}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-bold">
            <label htmlFor="sim-size">2 · Quelle taille ?</label>
          </h3>
          <output htmlFor="sim-size" className="wu-mono text-base font-semibold" aria-live="polite">
            {formatNumber(size[choice], 1)} {o.unit}
          </output>
        </div>
        <input
          id="sim-size"
          type="range"
          min={o.min}
          max={o.max}
          step={o.step}
          value={size[choice]}
          onChange={(e) => setSize({ ...size, [choice]: Number(e.target.value) })}
          className="h-11 w-full accent-ink"
        />
        <div aria-hidden className="flex justify-between px-2">
          {Array.from({ length: Math.round((o.max - o.min) / o.step) + 1 }, (_, i) => (
            <span
              key={i}
              className={`w-px bg-border-strong ${Number.isInteger(o.min + i * o.step) ? "h-2" : "h-1"}`}
            />
          ))}
        </div>
        <div className="wu-mono flex justify-between text-xs text-muted">
          <span>
            {formatNumber(o.min, 1)} {o.unit}
          </span>
          <span>
            {formatNumber(o.max, 0)} {o.unit}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">
          <label htmlFor="sim-price">3 · Pour quel prix, pose comprise ?</label>
        </h3>
        <div className="flex max-w-xs items-center gap-2">
          <input
            id="sim-price"
            inputMode="decimal"
            value={price}
            onChange={(e) => setTyped({ ...typed, [choice]: e.target.value })}
            className="h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-sm tabular-nums outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          <span className="wu-mono flex-none text-sm whitespace-nowrap text-ink-soft">
            {Number.isFinite(toNumber(price)) ? formatEur(toNumber(price)) : "€"}
          </span>
        </div>
        <p className="text-[13px] text-muted">
          Proposé d&apos;après des prix indicatifs ; mettez votre devis.
        </p>
      </div>

      <button
        type="button"
        disabled={pending}
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
        <p role="status" className="rounded-control bg-bg px-3.5 py-3 text-sm text-ink-soft">
          <strong className="text-ink">Simulation impossible :</strong> {UNAVAILABLE[view.reason]}
        </p>
      )}
      {ok && verdict && life && (
        <div role="status" className="flex flex-col gap-4 border-t border-track pt-5">
          <div className="flex flex-wrap items-center gap-3">
            {verdict.tone === "positive" ? (
              <DeltaChip tone="gain">{verdict.label}</DeltaChip>
            ) : verdict.tone === "soft" ? (
              <StatusChip tone="estimate">{verdict.label}</StatusChip>
            ) : (
              <DeltaChip tone="cost">{verdict.label}</DeltaChip>
            )}
            <p className="text-base font-bold text-pretty">
              {ok.paybackYears !== null
                ? `Amorti en ≈ ${formatNumber(ok.paybackYears, ok.paybackYears < 10 ? 1 : 0)} ans, pour une durée de vie de ${life.life}`
                : ok.costEur > 0
                  ? `Pas d'économie : ${formatEur(ok.costEur)} jamais remboursés`
                  : "Indiquez un prix pour estimer l'amortissement"}
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3">
            <div className="flex flex-col gap-0.5 rounded-control bg-bg px-4 py-3">
              <span className="text-sm text-ink-soft">Économie par an</span>
              <strong className="text-xl leading-tight tabular-nums">
                {ok.annual.savingsCents > 0 ? "≈ " : ""}
                {formatEurFromCents(ok.annual.savingsCents, 0)}
              </strong>
              <span className="text-[13px] text-muted tabular-nums">
                {formatNumber(ok.annual.importAvoidedKwh)} kWh d&apos;achats évités par an
              </span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-control bg-bg px-4 py-3">
              <span className="text-sm text-ink-soft">Amortissement simple</span>
              <strong className="text-xl leading-tight tabular-nums">
                {ok.paybackYears !== null
                  ? `${formatNumber(ok.paybackYears, ok.paybackYears < 10 ? 1 : 0)} ans`
                  : "—"}
              </strong>
              <span className="text-[13px] text-muted">durée de vie ≈ {life.life}</span>
            </div>
          </div>
          {ok.selfConsumption.before !== null && ok.selfConsumption.after !== null && (
            <p className="text-sm text-ink-soft">
              Autoconsommation : {formatPercent(ok.selfConsumption.before)} →{" "}
              <strong className="text-ink">{formatPercent(ok.selfConsumption.after)}</strong> de la
              production. {exportEnabled ? "Revente" : "Envoyé au réseau"} :{" "}
              {ok.annual.exportChangeKwh > 0 ? "+" : "−"}
              {formatNumber(Math.abs(ok.annual.exportChangeKwh))} kWh par an.
            </p>
          )}
          <details className="text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
              Hypothèses du calcul
            </summary>
            <p className="text-[13px] text-muted text-pretty">
              Rejoué sur {ok.days} jours de données ({fmtDate(ok.from)} – {fmtDate(ok.to)})
              {ok.days < 365 ? ", ramené à un an" : ""}, au prix de votre contrat actuel, sans
              hausse. Batterie : rendement aller-retour de 90 %, puissance égale à la moitié de la
              capacité, vide au départ ; panneaux ajoutés : même orientation que les vôtres.{" "}
              {exportEnabled
                ? "La revente perdue est déduite."
                : "Sans revente, le surplus envoyé au réseau ne rapporte rien."}{" "}
              Hors remplacement, entretien et aides. Estimation : un hiver ou des prix différents
              changeront le résultat.
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
