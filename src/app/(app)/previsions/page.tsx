import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge, button, Card, Icon, Notice, StatTile, tiles } from "@/components/ui";
import type { AccuracyDay } from "@/domain/forecast/accuracy";
import { windowLabel } from "@/domain/forecast/summary";
import { formatEurFromCents, formatKwh, formatPercent } from "@/lib/format";
import { addDays } from "@/lib/time";
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

/** Dernier jour comparé : production et consommation mesurées, et ce qui était prévu. */
function LastDay({ day, today }: { day: AccuracyDay; today: string }) {
  const when =
    day.date === addDays(today, -1) ? "hier" : `le ${day.date.slice(8)}/${day.date.slice(5, 7)}`;
  return (
    <div className={tiles}>
      {day.solar && (
        <StatTile
          label={`Production ${when}`}
          value={kwh(day.solar.actual)}
          sub={`prévue : ${kwh(day.solar.forecast)}`}
          dot="bg-solar"
        />
      )}
      <StatTile
        label={`Consommation ${when}`}
        value={kwh(day.load.actual)}
        sub={`prévue : ${kwh(day.load.forecast)}`}
      />
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
    ctx.profile.battery
      ? "Batterie supposée vide à minuit : son niveau n'est pas encore transmis par Home Assistant."
      : null,
  ].filter((n): n is string => n !== null);

  return (
    <>
      {header}
      <ForecastDay
        today={plan.today}
        timezone={tz}
        solar={ctx.profile.solar && plan.solarMethod !== null}
        battery={ctx.profile.battery}
        days={plan.days.map((d) => ({ ...d, fullAt: fullByDate.get(d.date) ?? null }))}
        hours={plan.hours.map((h, i) => ({
          start: h.start.toISOString(),
          solarKwh: h.solarKwh,
          loadKwh: h.loadKwh,
          importKwh: h.importKwh,
          exportKwh: h.exportKwh,
          kwhCostEur: costs?.[i]?.kwhCostEur ?? null,
        }))}
      />

      <Card
        icon="washer"
        title="Quand lancer vos appareils"
        description="Le créneau le moins cher d'ici demain soir pour chacun, surplus solaire compris."
      >
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
          <ul className="flex flex-col divide-y divide-track">
            {plan.windows.map(({ appliance, window }) => (
              <li key={appliance.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex size-9 flex-none items-center justify-center rounded-[10px] bg-bg text-ink-soft">
                  <Icon name={appliance.icon} size={18} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold">{appliance.name}</span>
                    {window && window.solarShare >= 0.5 && (
                      <Badge tone="positive">{formatPercent(window.solarShare)} solaire</Badge>
                    )}
                  </span>
                  {window ? (
                    <>
                      <span className="text-[13px] tabular-nums">
                        {windowLabel(window.start, window.end, plan.today, tz)}
                      </span>
                      <span className="text-[11px] text-muted tabular-nums">
                        ≈ {eur(window.costEur)}
                        {window.nowCostEur - window.costEur >= SAVING_MIN_EUR
                          ? ` au lieu de ${eur(window.nowCostEur)} en le lançant dès que possible`
                          : " : autant le lancer quand vous voulez"}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-muted">
                      Pas de créneau d&apos;ici demain soir : sa plage permise est plus courte que
                      sa durée ?
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href={settingsHref("appareils")} className={`${button.link} self-start`}>
          Gérer mes appareils
        </Link>
      </Card>

      <Card
        icon="check"
        title="Fiabilité des prévisions"
        description="Chaque soir, WattsUp garde sa prévision du lendemain, puis la compare à vos mesures."
      >
        {accuracy.days.length === 0 ? (
          <p className="text-[13px] text-muted">
            La première comparaison apparaîtra après-demain : la prévision de demain est enregistrée
            ce soir.
          </p>
        ) : (
          <>
            {accuracy.days[0] && <LastDay day={accuracy.days[0]} today={plan.today} />}
            <p className="text-[13px] text-ink-soft">
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
      </Card>

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
