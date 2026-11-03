import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ArrowLink, button, DeltaChip, Icon, IconChip, Notice } from "@/components/ui";
import type { AccuracyDay } from "@/domain/forecast/accuracy";
import { describeAppliance } from "@/domain/forecast/appliances";
import { hourLabel } from "@/domain/forecast/summary";
import { coveredFraction, toSegments } from "@/domain/tariff/base-hphc";
import { formatEurFromCents, formatKwh, formatPercent } from "@/lib/format";
import { addDays, localParts } from "@/lib/time";
import { settingsHref } from "@/lib/settings-tabs";
import { getForecastAccuracy, getForecastPlan } from "@/server/forecast";
import { pageContext } from "@/server/page";
import { ForecastDay } from "./forecast-day";

export const metadata = { title: "Prévisions · WattsUp Energy" };

// Prévisions « Demain » (T72, SPEC §7.14) : aujourd'hui et demain heure par heure, et le
// créneau le moins cher de chaque appareil déplaçable.

const eur = (v: number) => formatEurFromCents(v * 100, 2);
const kwh = (v: number) => formatKwh(v, v < 10 ? 1 : 0);
/** Écart sous lequel lancer tout de suite revient au même. */
const SAVING_MIN_EUR = 0.05;

const HOUR_MS = 3_600_000;

/** Part (0–1) de l'heure qui tombe en heures creuses, dans l'heure locale du foyer. */
function offPeakShareOf(start: Date, segments: [number, number][], timezone: string) {
  const p = localParts(start, timezone);
  return coveredFraction(segments, p.hour * 60 + p.minute, 60);
}
const hourStart = (d: Date) => d.getTime() - (d.getTime() % HOUR_MS);

/** « Aujourd'hui », « demain » ou « jeudi 12 » : le jour d'un créneau. */
function windowDay(start: Date, today: string, timezone: string) {
  const date = localParts(start, timezone).date;
  if (date === today) return "Aujourd'hui";
  if (date === addDays(today, 1)) return "Demain";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
  });
}

/** Dernier jour comparé : production et consommation mesurées, et ce qui était prévu. */
function LastDay({ day, today }: { day: AccuracyDay; today: string }) {
  const when =
    day.date === addDays(today, -1) ? "hier" : `le ${day.date.slice(8)}/${day.date.slice(5, 7)}`;
  const tile = (label: string, dot: string, actual: number, forecast: number) => (
    <div className="flex flex-col gap-1.5 rounded-control bg-bg px-4 py-3.5">
      <p className="wu-label flex items-center gap-2">
        <span aria-hidden className={`size-2.5 flex-none rounded-[3px] ${dot}`} />
        {label}
      </p>
      <p className="text-2xl font-semibold tracking-tight">{kwh(actual)}</p>
      <p className="wu-mono text-xs text-muted">prévue : {kwh(forecast)}</p>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
      {day.solar && tile(`Production ${when}`, "bg-solar", day.solar.actual, day.solar.forecast)}
      {tile(`Consommation ${when}`, "bg-ink", day.load.actual, day.load.forecast)}
    </div>
  );
}

export default async function ForecastPage() {
  const ctx = await pageContext("/previsions");
  const [plan, accuracy] = await Promise.all([getForecastPlan(ctx), getForecastAccuracy(ctx)]);
  const header = (
    <PageHeader
      title="Prévisions"
      subtitle="Aujourd'hui et demain heure par heure, et quand lancer vos appareils"
    />
  );

  if (plan.status === "daily") {
    return (
      <>
        {header}
        <Notice
          tone="info"
          title="Les prévisions heure par heure demandent des envois horaires."
          action={
            <Link href={settingsHref("home-assistant")} className={button.secondary}>
              Réglages Home Assistant
            </Link>
          }
        >
          Votre foyer envoie un total par jour : WattsUp ne connaît pas vos heures de consommation.
          La couleur Tempo de demain et vos heures creuses restent sur la Vue d&apos;ensemble.
        </Notice>
      </>
    );
  }
  if (plan.status === "no-data") {
    return (
      <>
        {header}
        <Notice tone="info" title="Pas encore assez de données pour prévoir.">
          Il faut au moins un jour complet d&apos;envois horaires de Home Assistant : les prévisions
          apparaîtront ici dès demain.
        </Notice>
      </>
    );
  }

  const tz = ctx.timezone;
  const fullByDate = new Map(plan.fullAt.map((f) => [f.date, f.start.toISOString()]));
  const costs = plan.priced?.hours;
  const offPeak = plan.priced?.offPeak ? toSegments(plan.priced.offPeak) : null;
  const notes = [
    ctx.profile.solar && plan.solarMethod === null
      ? "Indiquez votre commune (Réglages › Localisation) pour prévoir la production solaire."
      : null,
    plan.solarMethod === "kwc"
      ? "Production estimée d'après la puissance de vos panneaux : elle s'ajustera à votre installation après deux semaines de données horaires."
      : null,
    plan.priced && plan.priced.assumedTempoDays > 0
      ? "Couleur Tempo de demain pas encore publiée (vers 11 h) : jour bleu supposé."
      : null,
    ctx.profile.battery && !plan.batteryMeasured
      ? "Batterie supposée vide à minuit : envoyez son niveau depuis Home Assistant (blueprint, « Niveau de la batterie ») pour une simulation plus juste."
      : null,
  ].filter((n): n is string => n !== null);
  // Niveau mesuré puis simulé : présenté en puce « Estimé » dans le résumé du jour.
  const batteryNote =
    ctx.profile.battery && plan.batteryMeasured
      ? `Batterie : ${formatPercent(plan.batteryMeasured.percent / 100)} mesurés à ${hourLabel(plan.batteryMeasured.at, tz)}, simulée ensuite.`
      : null;

  const found = plan.windows.flatMap(({ appliance, window }) =>
    window ? [{ appliance, window }] : [],
  );
  const saving = (w: { nowCostEur: number; costEur: number }) =>
    Math.max(0, w.nowCostEur - w.costEur);
  const totalSaving = found.reduce((a, f) => a + saving(f.window), 0);

  // `tabDate` : le jour affiché par le sélecteur ; la mention du jour n'est gardée que sur une
  // fiche dont le créneau tombe un autre jour.
  const windowsSection = (tabDate: string) => (
    <section aria-labelledby="creneaux" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <h2 id="creneaux" className="text-[22px] font-semibold tracking-tight">
            Meilleurs créneaux pour {tabDate === plan.today ? "aujourd'hui" : "demain"}
          </h2>
          {totalSaving >= SAVING_MIN_EUR && (
            <p className="text-sm text-ink-soft">
              ≈ {eur(totalSaving)} économisés en tout, en respectant les contraintes de chaque
              appareil.
            </p>
          )}
        </div>
        <ArrowLink href={settingsHref("appareils")}>Gérer mes appareils</ArrowLink>
      </div>
      {!plan.priced ? (
        <Notice
          tone="info"
          title="Ajoutez votre contrat pour chiffrer les créneaux."
          action={
            <Link href="/contrats" className={button.secondary}>
              Ajouter mon contrat
            </Link>
          }
        />
      ) : plan.appliances === 0 ? (
        <Notice
          tone="info"
          title="Aucun appareil pour l'instant."
          action={
            <Link href={settingsHref("appareils")} className={button.secondary}>
              Ajouter mes appareils
            </Link>
          }
        >
          Lave-linge, ballon d&apos;eau chaude, recharge du véhicule… : WattsUp cherchera pour
          chacun le moment le moins cher.
        </Notice>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
          {plan.windows.map(({ appliance, window }) => (
            <li
              key={appliance.id}
              className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="flex size-10 flex-none items-center justify-center rounded-control bg-bg text-ink"
                >
                  <Icon name={appliance.icon} size={20} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <h3 className="text-[17px] font-semibold">{appliance.name}</h3>
                  <p className="wu-mono text-xs text-muted">{describeAppliance(appliance)}</p>
                </div>
              </div>
              {window ? (
                <>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="wu-mono text-[28px] leading-none font-semibold tracking-tight">
                      {hourLabel(window.start, tz)} – {hourLabel(window.end, tz)}
                    </span>
                    {window.solarShare >= 0.5 && (
                      <DeltaChip tone="gain">{formatPercent(window.solarShare)} solaire</DeltaChip>
                    )}
                  </p>
                  {saving(window) >= SAVING_MIN_EUR ? (
                    <>
                      <p>
                        <DeltaChip tone="gain">{eur(saving(window))} économisés</DeltaChip>
                      </p>
                      <p className="text-[13px] text-ink-soft tabular-nums">
                        {eur(window.costEur)} au lieu de {eur(window.nowCostEur)} en le lançant tout
                        de suite
                      </p>
                    </>
                  ) : (
                    <p className="text-[13px] text-ink-soft tabular-nums">
                      ≈ {eur(window.costEur)} : autant le lancer quand vous voulez
                    </p>
                  )}
                  {localParts(window.start, tz).date !== tabDate && (
                    <p className="text-[13px] text-muted">
                      {windowDay(window.start, plan.today, tz)}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-muted">
                  Pas de créneau d&apos;ici demain soir : sa plage permise est plus courte que sa
                  durée ?
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  // « Pourquoi cette heure plutôt que midi ? » : prix du kWh au meilleur créneau et à midi.
  const best = [...found].sort((x, y) => saving(y.window) - saving(x.window))[0];
  const bestIndex = best
    ? plan.hours.findIndex((h) => h.start.getTime() === hourStart(best.window.start))
    : -1;
  const noonIndex = best
    ? plan.hours.findIndex((h) => {
        const p = localParts(h.start, tz);
        return p.date === localParts(best.window.start, tz).date && p.hour === 12;
      })
    : -1;
  const bestHour = bestIndex >= 0 ? costs?.[bestIndex] : undefined;
  const noonHour = noonIndex >= 0 ? costs?.[noonIndex] : undefined;
  const sunnyNoon = noonIndex >= 0 && (plan.hours[noonIndex]?.solarKwh ?? 0) > 0.2;
  const bestLabel = best ? localParts(best.window.start, tz).hour : 0;
  const whySection =
    best &&
    bestHour &&
    noonHour &&
    saving(best.window) >= SAVING_MIN_EUR &&
    noonHour.kwhCostEur > bestHour.kwhCostEur + 0.005 &&
    bestLabel !== 12 ? (
      <section
        aria-labelledby="pourquoi"
        className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6"
      >
        <h2 id="pourquoi" className="text-lg font-semibold tracking-tight">
          Pourquoi {bestLabel < 6 || bestLabel >= 22 ? "la nuit" : `à ${bestLabel} h`} plutôt
          qu&apos;à midi{sunnyNoon ? ", en plein soleil" : ""} ?
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-4">
          <div className="flex flex-col gap-1.5 rounded-control bg-bg p-4">
            <p className="wu-label">Lancé à {bestLabel} h</p>
            <p>
              <span className="text-2xl font-semibold tracking-tight">
                {(bestHour.kwhCostEur * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
              </span>{" "}
              <span className="wu-mono text-[13px]">c€/kWh</span>
            </p>
            <p className="text-sm text-muted text-pretty">
              {best.window.solarShare >= 0.5
                ? "Le surplus solaire fait tourner l'appareil sans rien acheter."
                : "L'un des prix les plus bas de la journée."}
              {ctx.profile.battery && sunnyNoon && " La batterie garde son soleil pour la soirée."}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 rounded-control bg-bg p-4">
            <p className="wu-label">Lancé à 12 h</p>
            <p>
              <span className="text-2xl font-semibold tracking-tight">
                {(noonHour.kwhCostEur * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
              </span>{" "}
              <span className="wu-mono text-[13px]">c€/kWh</span>
            </p>
            <p className="text-sm text-muted text-pretty">
              {ctx.profile.battery && sunnyNoon
                ? "Le soleil de midi irait à l'appareil au lieu de la batterie : vous le rachèteriez plus cher le soir."
                : "Le kWh coûte plus cher à cette heure."}
            </p>
          </div>
        </div>
      </section>
    ) : null;

  return (
    <>
      <ForecastDay
        today={plan.today}
        timezone={tz}
        solar={ctx.profile.solar && plan.solarMethod !== null}
        battery={ctx.profile.battery}
        batteryNote={batteryNote}
        appliances={found.map(({ appliance, window }) => ({
          id: appliance.id,
          name: appliance.name,
          icon: appliance.icon,
          start: window.start.toISOString(),
          end: window.end.toISOString(),
        }))}
        windowsByDay={Object.fromEntries(plan.days.map((d) => [d.date, windowsSection(d.date)]))}
        why={whySection}
        days={plan.days.map((d) => ({ ...d, fullAt: fullByDate.get(d.date) ?? null }))}
        hours={plan.hours.map((h, i) => ({
          start: h.start.toISOString(),
          solarKwh: h.solarKwh,
          loadKwh: h.loadKwh,
          importKwh: h.importKwh,
          exportKwh: h.exportKwh,
          kwhCostEur: costs?.[i]?.kwhCostEur ?? null,
          priceEur: costs?.[i]?.priceEurKwh ?? null,
          offPeakShare: offPeak ? offPeakShareOf(h.start, offPeak, tz) : null,
          measured: h.measured,
          estimated: h.estimated,
        }))}
      />

      <section
        aria-labelledby="fiabilite"
        className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6 sm:p-7"
      >
        <div className="flex items-center gap-3">
          <IconChip icon="check" size="lg" />
          <div className="flex flex-col gap-0.5">
            <h2 id="fiabilite" className="text-lg font-semibold tracking-tight">
              Fiabilité des prévisions
            </h2>
            <p className="text-sm text-muted">
              Chaque soir, WattsUp garde sa prévision du lendemain, puis la compare à vos mesures.
            </p>
          </div>
        </div>
        {accuracy.days.length === 0 ? (
          <p className="text-[13px] text-muted">
            La première comparaison apparaîtra après-demain : la prévision de demain est enregistrée
            ce soir.
          </p>
        ) : (
          <>
            {accuracy.days[0] && <LastDay day={accuracy.days[0]} today={plan.today} />}
            <p className="text-sm text-muted">
              Écart moyen sur {accuracy.days.length} jour{accuracy.days.length > 1 ? "s" : ""} :{" "}
              {[
                accuracy.solarError !== null && `production ${formatPercent(accuracy.solarError)}`,
                accuracy.loadError !== null && `consommation ${formatPercent(accuracy.loadError)}`,
              ]
                .filter(Boolean)
                .join(", ")}
              .
            </p>
          </>
        )}
      </section>

      {notes.length > 0 && (
        <ul className="flex flex-col gap-1 px-1 text-[11px] text-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </>
  );
}
