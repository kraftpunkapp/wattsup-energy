"use client";

import { useState, type ReactNode } from "react";
import { Gauge, Legend, Segmented, StatTile, tiles } from "@/components/ui";
import { hourLabel } from "@/domain/forecast/summary";
import { formatEurFromCents, formatKwh, formatPercent } from "@/lib/format";
import { localParts } from "@/lib/time";
import { HourlyDetail, type DayAppliance } from "./hourly-detail";

// Aujourd'hui ou demain heure par heure (T72, SPEC §7.14) : consommation prévue (couverte
// sur place ou achetée), production prévue en barre claire derrière, coût d'un kWh de plus
// en courbe. Toucher une heure affiche son détail. Aujourd'hui, les heures écoulées montrent
// le mesuré et les heures à venir, plus claires, la prévision ; la consommation prévue suit
// en courbe, pleine sur les heures écoulées (ce qui était prévu), en pointillés ensuite.

export interface ForecastHourView {
  /** ISO, début de l'heure. */
  start: string;
  solarKwh: number;
  loadKwh: number;
  importKwh: number;
  exportKwh: number;
  /** Coût d'un kWh de plus (€), null sans contrat. */
  kwhCostEur: number | null;
  /** Prix du kWh acheté à cette heure (€), null sans contrat. */
  priceEur: number | null;
  /** Part de l'heure en heures creuses (0–1), null sans heures creuses au contrat. */
  offPeakShare: number | null;
  /** Heure écoulée : valeurs mesurées. */
  measured: boolean;
  /** Heure écoulée : ce qui était estimé (prévision figée la veille, sinon le modèle). */
  estimated: { solarKwh: number; loadKwh: number } | null;
}

export interface ForecastDayView {
  date: string;
  solarKwh: number;
  loadKwh: number;
  importKwh: number;
  exportKwh: number;
  costEur: number | null;
  /** ISO de l'heure où la batterie sera pleine, null sinon. */
  fullAt: string | null;
  /** Part déjà mesurée (aujourd'hui). */
  measured: { solarKwh: number; loadKwh: number; hours: number };
}

const kwh = (v: number) => formatKwh(v, v < 10 ? 1 : 0);
const eur = (v: number) => formatEurFromCents(v * 100, 2);

export function ForecastDay({
  days,
  hours,
  today,
  timezone,
  solar,
  battery,
  windows,
  why,
  bestSlot,
  appliances,
}: {
  /** Créneaux conseillés des appareils (tous jours confondus). */
  appliances: DayAppliance[];
  /** « cette nuit, de 1 h à 5 h » : le créneau d'appareil le plus économe, null sans. */
  bestSlot: string | null;
  windows: ReactNode;
  why: ReactNode;
  days: ForecastDayView[];
  hours: ForecastHourView[];
  today: string;
  timezone: string;
  solar: boolean;
  battery: boolean;
}) {
  const [date, setDate] = useState(days.at(-1)?.date ?? today);
  const [picked, setPicked] = useState<string | null>(null);
  const day = days.find((d) => d.date === date) ?? days[0];
  const list = hours.filter((h) => localParts(new Date(h.start), timezone).date === date);
  const focus = list.find((h) => h.start === picked) ?? null;
  const priced = list.some((h) => h.kwhCostEur !== null);
  // Heures écoulées avec leur estimation : bilan « depuis minuit ».
  const past = list.filter((h) => h.estimated !== null);
  const sum = (pick: (h: ForecastHourView) => number) => past.reduce((a, h) => a + pick(h), 0);
  if (!day) return null;

  const sinceMidnight = (
    <>
      {past.length > 0 && (
        <p className="text-[13px] text-ink-soft tabular-nums">
          Depuis minuit : {kwh(sum((h) => h.loadKwh))} consommés pour{" "}
          {kwh(sum((h) => h.estimated?.loadKwh ?? 0))} prévus
          {solar &&
            ` · ${kwh(sum((h) => h.solarKwh))} produits pour ${kwh(sum((h) => h.estimated?.solarKwh ?? 0))} prévus`}
          .
        </p>
      )}
    </>
  );
  const dayAppliances = appliances.filter(
    (a) => localParts(new Date(a.start), timezone).date === date,
  );
  const hourly = (description: string) => (
    <HourlyDetail
      list={list}
      timezone={timezone}
      today={today}
      date={date}
      solar={solar}
      battery={battery}
      priced={priced}
      appliances={dayAppliances}
      focus={focus}
      onPick={setPicked}
      description={description}
      footer={sinceMidnight}
    />
  );
  const tomorrow = date !== today;
  const switcher = (
    <Segmented
      label="Jour"
      value={date}
      onChange={(d) => {
        setDate(d);
        setPicked(null);
      }}
      options={days.map((d) => ({
        value: d.date,
        label: d.date === today ? "Aujourd'hui" : "Demain",
      }))}
    />
  );

  if (tomorrow) {
    // Origine de l'électricité consommée : réseau, panneaux en direct, batterie.
    const dayHours = list;
    const covered = (h: ForecastHourView) => Math.max(0, h.loadKwh - h.importKwh);
    const direct = dayHours.reduce((a, h) => a + Math.min(h.solarKwh, covered(h)), 0);
    const stored = dayHours.reduce((a, h) => a + covered(h) - Math.min(h.solarKwh, covered(h)), 0);
    const offPeakKwh = dayHours.reduce((a, h) => a + h.importKwh * (h.offPeakShare ?? 0), 0);
    const hasOffPeak = dayHours.some((h) => h.offPeakShare !== null);
    const avoided = dayHours.reduce((a, h) => a + covered(h) * (h.priceEur ?? 0), 0);
    const parts = [
      { label: "Réseau", kwh: day.importKwh, color: "bg-grid" },
      ...(solar ? [{ label: "Panneaux", kwh: direct, color: "bg-solar" }] : []),
      ...(battery ? [{ label: "Batterie", kwh: stored, color: "bg-battery" }] : []),
    ];
    return (
      <>
        <div className="flex">{switcher}</div>
        <section
          aria-labelledby="achats"
          className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6 sm:p-7"
        >
          <h2 id="achats" className="text-[15px] font-semibold text-muted">
            Achats au réseau prévus demain
          </h2>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <p className="text-[56px] leading-none font-bold tracking-[-0.03em] tabular-nums">
              {day.costEur !== null ? `≈ ${eur(day.costEur)}` : kwh(day.importKwh)}
            </p>
            <p className="text-base text-ink-soft tabular-nums">
              {kwh(day.importKwh)} achetés
              {hasOffPeak && day.importKwh > 0
                ? `, dont ${formatPercent(offPeakKwh / day.importKwh)} en heures creuses`
                : ""}
              {day.costEur !== null ? " · hors abonnement" : ""}
            </p>
          </div>
          <p className="text-sm text-ink-soft tabular-nums">
            Consommation prévue : {kwh(day.loadKwh)}
            {battery &&
              day.fullAt &&
              ` · batterie pleine vers ${hourLabel(new Date(day.fullAt), timezone)}`}
          </p>
          {parts.length > 1 && (
            <>
              <Gauge
                parts={parts.map((p) => ({ value: p.kwh, color: p.color }))}
                label={`Consommation prévue demain : ${parts.map((p) => `${p.label} ${kwh(p.kwh)}`).join(", ")}`}
              />
              <Legend
                columns={parts.length === 3 ? 3 : 2}
                items={parts.map((p) => ({ color: p.color, label: p.label, value: kwh(p.kwh) }))}
              />
            </>
          )}
          {(solar || battery) && avoided >= 0.05 && (
            <p className="rounded-control bg-bg px-3.5 py-3 text-sm text-ink-soft">
              {solar && battery
                ? "Le soleil et la batterie vous évitent"
                : solar
                  ? "Le soleil vous évite"
                  : "La batterie vous évite"}{" "}
              <strong className="text-ink">≈ {eur(avoided)}</strong> d&apos;achats demain.
            </p>
          )}
        </section>
        {windows}
        {why}
        {hourly("Pour aller plus loin : touchez une heure.")}
      </>
    );
  }

  // Aujourd'hui : verdict (mesuré face à ce qui était prévu), chaîne de causes, puis le détail.
  const hasPast = past.length > 0;
  const solarAct = sum((h) => h.solarKwh);
  const solarEst = sum((h) => h.estimated?.solarKwh ?? 0);
  const loadAct = sum((h) => h.loadKwh);
  const loadEst = sum((h) => h.estimated?.loadKwh ?? 0);
  const solarGap = solar && solarEst >= 0.5 ? solarAct / solarEst - 1 : null;
  const loadGap = loadEst >= 0.5 ? loadAct / loadEst - 1 : null;
  const hourOf = (h: ForecastHourView) => localParts(new Date(h.start), timezone).hour;
  const lowSun = past.filter(
    (h) => h.estimated && h.estimated.solarKwh > 0.2 && h.solarKwh < 0.6 * h.estimated.solarKwh,
  );
  const overLoad = [...past]
    .filter((h) => h.estimated && h.loadKwh - h.estimated.loadKwh > 0.1)
    .sort(
      (x, y) => y.loadKwh - (y.estimated?.loadKwh ?? 0) - (x.loadKwh - (x.estimated?.loadKwh ?? 0)),
    )
    .slice(0, 2)
    .sort((x, y) => hourOf(x) - hourOf(y));
  const upcoming = list.filter((h) => !h.measured);
  const evening = upcoming.reduce((a, h) => a + h.importKwh * (h.priceEur ?? 0), 0);
  const eveningKnown = upcoming.some((h) => h.priceEur !== null);
  const lastHour = past.at(-1);
  const nowLabel = lastHour
    ? hourLabel(new Date(new Date(lastHour.start).getTime() + 3_600_000), timezone)
    : null;
  const pct = (v: number) => `${v > 0 ? "+" : "−"}${formatPercent(Math.abs(v))}`;
  const closeEnough = (v: number | null) => v === null || Math.abs(v) < 0.1;

  let headline: string;
  if (solarGap !== null && solarGap <= -0.1)
    headline = "Le soleil est en retrait par rapport à la prévision.";
  else if (solarGap !== null && solarGap >= 0.1)
    headline = "Le soleil est plus généreux que prévu.";
  else if (loadGap !== null && loadGap >= 0.1) headline = "Vous consommez un peu plus que prévu.";
  else if (loadGap !== null && loadGap <= -0.1) headline = "Vous consommez un peu moins que prévu.";
  else headline = "La journée suit la prévision.";

  const steps: { label: string; big: string; line: string }[] = [];
  if (solarGap !== null && !closeEnough(solarGap)) {
    steps.push({
      label: "La cause",
      big: `${pct(solarGap)} de soleil`,
      line: `${kwh(solarAct)} produits au lieu de ${kwh(solarEst)} prévus${
        lowSun.length > 0
          ? ` · production sous la prévue de ${hourOf(lowSun[0] as ForecastHourView)} h à ${hourOf(lowSun.at(-1) as ForecastHourView) + 1} h`
          : ""
      }`,
    });
  }
  if (battery && day.fullAt) {
    steps.push({
      label: steps.length ? "Donc" : "Batterie",
      big: `pleine vers ${hourLabel(new Date(day.fullAt), timezone)}`,
      line: "d'après la production mesurée et la prévision des heures à venir",
    });
  } else if (battery && hasPast && upcoming.length > 0) {
    steps.push({
      label: steps.length ? "Donc" : "Batterie",
      big: "pas pleine aujourd'hui",
      line: "pas assez de surplus prévu pour la remplir",
    });
  }
  if (eveningKnown && upcoming.length > 0) {
    steps.push({
      label: steps.length ? "Et ce soir" : "D'ici minuit",
      big: `≈ ${eur(evening)} d'achats`,
      line: `${kwh(upcoming.reduce((a, h) => a + h.importKwh, 0))} à acheter au réseau jusqu'à minuit, hors abonnement`,
    });
  }

  return (
    <>
      <div className="flex">{switcher}</div>
      {hasPast ? (
        <section
          aria-labelledby="verdict"
          className="flex flex-col gap-5 rounded-card border border-border bg-surface p-6 sm:p-7"
        >
          <p className="text-[15px] font-semibold text-muted">
            Aujourd&apos;hui, à {nowLabel} · comparé à la prévision de la veille
          </p>
          <h2
            id="verdict"
            className="text-[28px] leading-tight font-bold tracking-tight text-balance"
          >
            {headline}
          </h2>
          {steps.length > 0 && (
            <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] gap-3">
              {steps.map((st) => (
                <li key={st.label} className="flex flex-col gap-1 rounded-control bg-bg p-4">
                  <span className="text-[13px] font-semibold text-muted">{st.label}</span>
                  <span className="text-[22px] leading-tight font-bold tabular-nums">{st.big}</span>
                  <span className="text-sm text-ink-soft text-pretty">{st.line}</span>
                </li>
              ))}
            </ol>
          )}
          <ul className="flex flex-col gap-1.5 text-[15px] text-ink-soft">
            {bestSlot && (
              <li>
                <strong className="text-ink">Meilleur créneau pour vos appareils :</strong>{" "}
                {bestSlot}
              </li>
            )}
            {loadGap !== null && Math.abs(loadGap) >= 0.1 && (
              <li>
                <strong className="text-ink">Aussi :</strong>{" "}
                {loadGap > 0 ? "un peu plus" : "un peu moins"} consommé que prévu ({pct(loadGap)})
                {loadGap > 0 && overLoad.length > 0
                  ? `, surtout à ${overLoad.map((h) => `${hourOf(h)} h`).join(" et ")}`
                  : ""}
                .
              </li>
            )}
          </ul>
        </section>
      ) : (
        <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-6">
          <h2 className="text-xl font-bold">Aujourd&apos;hui</h2>
          <div className={tiles}>
            {solar && (
              <StatTile label="Production prévue" value={kwh(day.solarKwh)} dot="bg-solar" />
            )}
            <StatTile label="Consommation prévue" value={kwh(day.loadKwh)} />
            <StatTile
              label="Achats au réseau"
              value={kwh(day.importKwh)}
              sub={day.costEur !== null ? `≈ ${eur(day.costEur)} hors abonnement` : undefined}
              dot="bg-grid"
            />
          </div>
        </section>
      )}
      {hourly(
        hasPast
          ? `Avant ${nowLabel} : mesuré, avec ce qui était prévu en trait noir. Après : la prévision mise à jour.`
          : "D'après vos habitudes, la météo et votre contrat.",
      )}
      {windows}
    </>
  );
}
