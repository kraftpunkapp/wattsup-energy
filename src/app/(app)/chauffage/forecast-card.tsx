"use client";

import { useState } from "react";
import { button, Icon, Notice, Segmented } from "@/components/ui";
import type { Forecast, Scenario } from "@/domain/heating/forecast";
import type { Fuel } from "@/domain/heating/fuel";
import { formatNumber } from "@/lib/format";
import type { FuelForecast, RefillForecastView } from "@/server/queries/heating";
import { FUEL_LABELS } from "./labels";

// Réapprovisionnement, le détail (T27) : à gauche la saison en cours (trois hivers possibles
// face au stock), à droite la saison prochaine (le type d'hiver se choisit, le reste suit).
// Tous les cas sont calculés côté serveur ; le sélecteur ne fait que choisir lequel afficher.

const SCENARIOS: Scenario[] = ["doux", "moyen", "rigoureux"];
const SCENARIO_NAMES: Record<Scenario, string> = {
  doux: "doux",
  moyen: "moyen",
  rigoureux: "rigoureux",
};

type Ok = Extract<Forecast, { status: "ok" }>;

const eur = (n: number) => `${formatNumber(Math.round(n / 5) * 5)} €`;
const eyebrow = "wu-label";

export function ForecastCard({
  view,
  currentEnd,
}: {
  view: RefillForecastView;
  /** « fin avril » : fin de la saison en cours, null hors saison. */
  currentEnd: string | null;
}) {
  const [fuel, setFuel] = useState<Fuel>(view.fuels[0]?.fuel ?? "pellet");
  const [scenario, setScenario] = useState<Scenario>("moyen");
  const f: FuelForecast | undefined = view.fuels.find((x) => x.fuel === fuel) ?? view.fuels[0];
  if (!f) return null;
  const pellet = f.fuel === "pellet";
  const bagKg = view.bagKg;
  const unit = pellet ? "sacs" : "stères";
  // Du kg ou des stères de base à l'unité affichée : sacs entiers (au sac supérieur) ou demi-stères.
  const need = (base: number) =>
    pellet ? Math.max(0, Math.ceil(base / bagKg - 1e-9)) : Math.max(0, Math.round(base * 10) / 10);
  const left = (base: number) =>
    pellet ? Math.floor(base / bagKg + 1e-9) : Math.round(base * 10) / 10;
  const digits = pellet ? 0 : 1;
  const num = (n: number) => formatNumber(n, digits);
  const word = (n: number) => (pellet ? `sac${n >= 2 ? "s" : ""}` : `stère${n >= 2 ? "s" : ""}`);
  const noun = pellet ? "de granulés" : "de bois";

  const cur = f.current;
  const curOk = cur && SCENARIOS.every((s) => cur[s].status === "ok");
  const next = f.next[scenario];

  return (
    <section
      aria-labelledby="appro"
      className="flex flex-col gap-5 rounded-card border border-border bg-surface p-6 sm:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="appro" className="text-[15px] font-bold">
          Réapprovisionnement · le détail
        </h2>
        <span className="text-sm text-muted">
          D&apos;après vos deux dernières saisons, ajustées au froid
        </span>
      </div>
      {view.fuels.length > 1 && (
        <div className="flex">
          <Segmented
            label="Combustible"
            value={fuel}
            onChange={setFuel}
            options={view.fuels.map((x) => ({ value: x.fuel, label: FUEL_LABELS[x.fuel] }))}
          />
        </div>
      )}
      {next.status === "insufficient" && !curOk ? (
        <Notice
          tone="info"
          title="Données insuffisantes :"
          action={
            <a href="#consommation-passee" className={button.secondary}>
              Saisir une consommation passée
            </a>
          }
        >
          il faut au moins une saison de chauffe avec des consommations saisies (sacs versés,
          relevés de stock, ou totaux mensuels des saisons passées).
        </Notice>
      ) : (
        <div className="flex flex-wrap gap-7">
          {curOk && cur && (
            <CurrentSeason
              f={f}
              scenarios={cur as Record<Scenario, Ok>}
              end={currentEnd}
              need={need}
              left={left}
              num={num}
              unit={unit}
              noun={noun}
            />
          )}
          <div
            className={`flex min-w-0 flex-[1_1_440px] flex-col gap-4 ${
              curOk ? "lg:border-l lg:border-track lg:pl-7" : ""
            }`}
          >
            <h3 className={eyebrow}>Saison prochaine · {f.nextLabel.replace("-", " – ")}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-sm text-ink-soft">Si l&apos;hiver est…</span>
              <Segmented
                label="Type d'hiver à prévoir"
                value={scenario}
                onChange={setScenario}
                options={SCENARIOS.map((s) => ({ value: s, label: SCENARIO_NAMES[s] }))}
              />
            </div>
            {next.status === "ok" ? (
              <NextSeason
                f={f}
                forecast={next}
                scenario={scenario}
                need={need}
                num={num}
                word={word}
                noun={noun}
                bagsPerPallet={view.bagsPerPallet}
                remainingLabel={
                  f.currentLabel && currentEnd
                    ? `Restant ${currentEnd} ${f.currentLabel.slice(-4)}`
                    : "Stock disponible"
                }
              />
            ) : (
              <p className="text-sm text-muted">Pas assez de données pour la saison prochaine.</p>
            )}
            {view.fuels.length === 1 && pellet && (
              <p className="flex items-center gap-3 rounded-control border border-dashed border-dash px-3.5 py-3 text-sm text-ink-soft">
                <span aria-hidden className="text-muted">
                  <Icon name="log" size={16} />
                </span>
                <span>
                  <strong className="text-ink">Bois</strong> : pas encore suivi. Renseignez un achat
                  pour l&apos;inclure dans la prévision.
                </span>
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Saison en cours : le besoin de chaque type d'hiver, avec le stock en repère. */
function CurrentSeason({
  f,
  scenarios,
  end,
  need,
  left,
  num,
  unit,
  noun,
}: {
  f: FuelForecast;
  scenarios: Record<Scenario, Ok>;
  end: string | null;
  need: (base: number) => number;
  left: (base: number) => number;
  num: (n: number) => string;
  unit: string;
  noun: string;
}) {
  const moyen = scenarios.moyen;
  const rigorous = scenarios.rigoureux;
  const stock = left(moyen.stock);
  const biggest = Math.max(stock, ...SCENARIOS.map((s) => need(scenarios[s].remaining)), 1);
  const scale = biggest / 0.867;
  const enough = rigorous.toBuy <= 0;
  const buyMoyen = need(moyen.toBuy);
  const tint = f.fuel === "pellet" ? "bg-pellet" : "bg-wood";
  const label = `Besoin ${end ? `jusqu'à ${end.replace(/^fin /, "fin ")}` : "de la saison"} : ${SCENARIOS.map(
    (s) => `${num(need(scenarios[s].remaining))} ${unit} si l'hiver est ${SCENARIO_NAMES[s]}`,
  ).join(", ")}. Stock : ${num(stock)} ${unit}.`;
  return (
    <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-4">
      <h3 className={eyebrow}>Cette saison{end ? ` · jusqu'à ${end}` : ""}</h3>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 flex-none items-center justify-center rounded-full bg-track text-ink"
        >
          <Icon name="check" size={20} />
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="text-base font-bold">
            {moyen.toBuy <= 0 ? "Rien à acheter" : `À acheter : ${num(buyMoyen)} ${unit}`}
          </p>
          <p className="text-sm text-ink-soft text-pretty">
            {moyen.toBuy <= 0
              ? enough
                ? `Vos ${num(stock)} ${unit} suffisent, même si l'hiver est rude.`
                : `Vos ${num(stock)} ${unit} suffisent pour un hiver moyen ; un hiver rigoureux en demanderait ${num(need(rigorous.toBuy))} de plus.`
              : `Il manque ≈ ${num(buyMoyen)} ${unit} ${noun} pour finir un hiver moyen.`}
          </p>
        </div>
      </div>
      <div role="img" aria-label={label} className="flex flex-col gap-1.5">
        <div className="flex gap-3 text-[13px] text-muted">
          <span className="w-[84px] flex-none">Si l&apos;hiver est…</span>
          <span className="flex-1">
            {unit === "sacs" ? "Sacs nécessaires" : "Stères nécessaires"}
          </span>
          <span className="w-14 flex-none text-right">Marge</span>
        </div>
        {SCENARIOS.map((s) => {
          const n = need(scenarios[s].remaining);
          const margin = stock - n;
          const main = s === "moyen";
          return (
            <div key={s} className="flex min-h-[34px] items-center gap-3">
              <span className={`w-[84px] flex-none text-sm ${main ? "font-bold" : ""}`}>
                {SCENARIO_NAMES[s]}
              </span>
              <div className="relative h-[22px] flex-1 rounded-[6px] bg-bg">
                <div
                  className={`wu-grow-x absolute inset-y-0 left-0 flex items-center justify-end rounded-[6px] pr-2 text-[13px] ${tint} ${
                    main
                      ? "font-bold text-on-fill"
                      : "bg-opacity-40 font-semibold text-ink opacity-45"
                  }`}
                  style={{ width: `${(n / scale) * 100}%` }}
                >
                  {main && num(n)}
                </div>
                {!main && (
                  <span
                    className="absolute inset-y-0 flex items-center text-[13px] font-semibold tabular-nums"
                    style={{ left: `calc(${(n / scale) * 100}% - 28px)` }}
                  >
                    {num(n)}
                  </span>
                )}
                <div
                  className="absolute -top-1.5 -bottom-1.5 w-0.5 bg-ink"
                  style={{ left: `${(stock / scale) * 100}%` }}
                />
              </div>
              <span
                className={`w-14 flex-none text-right text-sm tabular-nums ${main ? "font-bold" : "font-semibold"}`}
              >
                {margin >= 0 ? "+" : "−"}
                {num(Math.abs(margin))}
              </span>
            </div>
          );
        })}
        <div className="flex gap-3 text-[13px]">
          <span className="w-[84px] flex-none" />
          <div className="relative h-[18px] flex-1">
            <span
              className="absolute font-bold whitespace-nowrap -translate-x-1/2"
              style={{ left: `${(stock / scale) * 100}%` }}
            >
              stock {num(stock)}
            </span>
          </div>
          <span className="w-14 flex-none" />
        </div>
      </div>
    </div>
  );
}

/** Saison prochaine : ce qu'il faut acheter pour le type d'hiver choisi. */
function NextSeason({
  f,
  forecast,
  scenario,
  need,
  num,
  word,
  noun,
  bagsPerPallet,
  remainingLabel,
}: {
  f: FuelForecast;
  forecast: Ok;
  scenario: Scenario;
  need: (base: number) => number;
  num: (n: number) => string;
  word: (n: number) => string;
  noun: string;
  bagsPerPallet: number;
  remainingLabel: string;
}) {
  const pellet = f.fuel === "pellet";
  const buy = pellet ? (forecast.order.bags ?? 0) : (forecast.order.steres ?? 0);
  const needed = need(forecast.need);
  const leftover = need(forecast.stock);
  const pallets = pellet ? forecast.order.pallets : null;
  const spare = pallets ? pallets * bagsPerPallet - buy : null;
  return (
    <>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 flex-none items-center justify-center rounded-control bg-pellet/15 text-ink"
        >
          <Icon name={pellet ? "bag" : "plus"} size={20} />
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="text-base font-bold">
            {buy <= 0
              ? "Rien à acheter pour cette saison"
              : `Prévoyez ${num(buy)} ${word(buy)} ${noun}`}
          </p>
          <p className="text-sm text-ink-soft">
            {forecast.costEur !== null && buy > 0
              ? `≈ ${eur(forecast.costEur)} au prix de votre dernier achat, pour un hiver ${SCENARIO_NAMES[scenario]}`
              : `pour un hiver ${SCENARIO_NAMES[scenario]}${forecast.costEur === null && buy > 0 ? " · coût inconnu : aucun achat chiffré" : ""}`}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <div className="flex flex-col gap-0.5 rounded-control bg-bg px-3.5 py-3">
          <span className="text-[13px] text-ink-soft">Besoin de la saison</span>
          <strong className="text-[15px] tabular-nums sm:text-base">
            {num(needed)} {word(needed)}
          </strong>
        </div>
        <div className="flex flex-col gap-0.5 rounded-control bg-bg px-3.5 py-3">
          <span className="text-[13px] text-ink-soft">{remainingLabel}</span>
          <strong className="text-[15px] tabular-nums sm:text-base">
            − {num(leftover)} {word(leftover)}
          </strong>
        </div>
        <div className="flex flex-col gap-0.5 rounded-control bg-pellet/15 px-3.5 py-3">
          <span className="text-[13px] text-ink">À acheter</span>
          <strong className="text-[15px] tabular-nums sm:text-base">
            = {num(buy)} {word(buy)}
          </strong>
        </div>
      </div>
      {pallets && spare !== null && buy > 0 && (
        <p className="flex items-start gap-2.5 rounded-control bg-bg px-3.5 py-3 text-sm text-ink-soft">
          <span aria-hidden className="mt-0.5 flex-none text-ink">
            <Icon name="bulb" size={16} />
          </span>
          <span>
            À la palette, on achète par {formatNumber(bagsPerPallet)} sacs :{" "}
            <strong className="text-ink">
              {pallets} palette{pallets > 1 ? "s" : ""}
            </strong>{" "}
            couvre{pallets > 1 ? "nt" : ""} {f.nextLabel.replace("-", " – ")}
            {spare > 0 && ` et laisse ≈ ${formatNumber(spare)} sacs d'avance`}.
          </span>
        </p>
      )}
    </>
  );
}
