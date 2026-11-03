import Link from "next/link";
import { PeriodLink } from "@/components/period-transition";
import { Badge, button, KpiTile, Notice } from "@/components/ui";
import { monthLabel, shortMonth } from "@/domain/overview";
import { formatEurFromCents, formatNumber, formatPercent } from "@/lib/format";
import type { HeatingView } from "@/server/queries/heating";
import { FUEL_LABELS } from "./labels";
import { settingsHref } from "@/lib/settings-tabs";

// Vue Chauffage (T26) : saison, chiffres clés comparés à N-1, coût mensuel par source et
// degrés-jours alignés (deux graphiques sur le même axe du temps, pas de double échelle).

const eur = (cents: number) => formatEurFromCents(cents, 0);
const temp = (t: number) => `${t.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} °C`;
const delta = (current: number, previous: number | undefined | null) =>
  previous && previous > 0 ? current / previous - 1 : null;
const deltaText = (d: number | null, label: string) =>
  d === null
    ? undefined
    : Math.abs(d) < 0.005
      ? `stable vs ${label}`
      : `${d > 0 ? "+" : "−"}${formatPercent(Math.abs(d))} vs ${label}`;

const SOURCES = [
  { key: "electric", label: "Radiateurs", color: "bg-eheat" },
  { key: "pellet", label: FUEL_LABELS.pellet, color: "bg-pellet" },
  { key: "wood", label: FUEL_LABELS.wood, color: "bg-wood" },
] as const;

const chevron = (d: string) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
);

export function SeasonSwitcher({ view }: { view: HeatingView }) {
  const arrow = (year: number | null, label: string, path: string) =>
    year !== null ? (
      <PeriodLink
        href={`/chauffage?s=${year}`}
        aria-label={label}
        className="flex size-11 items-center justify-center rounded-control text-ink hover:bg-track"
      >
        {chevron(path)}
      </PeriodLink>
    ) : (
      <span className="flex size-11 items-center justify-center text-dash" aria-hidden>
        {chevron(path)}
      </span>
    );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 rounded-control border border-border bg-surface p-0.5">
        {arrow(view.nav.prev, "Saison précédente", "M15 6l-6 6 6 6")}
        <span className="min-w-36 text-center text-sm font-semibold">
          Saison {view.season.label}
        </span>
        {arrow(view.nav.next, "Saison suivante", "M9 6l6 6-6 6")}
      </div>
      {view.inProgress && <Badge tone="active">En cours</Badge>}
    </div>
  );
}

/** Chiffres clés de la saison, comparés à la saison précédente sur la même durée. */
export function HeatingKpis({ view }: { view: HeatingView }) {
  const { current, previous, modules, inProgress } = view;
  const previousLabel = inProgress ? "même période N-1" : "saison précédente";
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-4">
      <KpiTile
        icon="tag"
        label="Coût de la saison"
        value={formatNumber(current.cost.totalCents / 100)}
        unit="€"
        sub={deltaText(delta(current.cost.totalCents, previous?.cost.totalCents), previousLabel)}
      />
      {modules.pellet && <PelletTile view={view} previousLabel={previousLabel} />}
      {modules.wood && (
        <KpiTile
          icon="flame"
          tone="wood"
          label="Bois brûlé"
          value={formatNumber(current.fuels.wood?.qty ?? 0, 1)}
          unit="stères"
          sub={
            previous?.fuels.wood
              ? `${previousLabel} : ${formatNumber(previous.fuels.wood.qty, 1)} st.`
              : undefined
          }
        />
      )}
      {modules.electric && (
        <KpiTile
          icon="plug"
          tone="eheat"
          label="Radiateurs"
          value={formatNumber(current.electricKwh)}
          unit="kWh"
          sub={
            previous ? `${previousLabel} : ${formatNumber(previous.electricKwh)} kWh` : undefined
          }
        />
      )}
      <KpiTile
        icon="thermometer"
        tone="grid"
        label="Température moyenne"
        value={current.tMean === null ? "—" : formatNumber(current.tMean, 1)}
        unit="°C"
        sub={
          current.dju !== null
            ? `${formatNumber(current.dju)} degrés-jours${previous?.tMean != null ? ` · N-1 ${temp(previous.tMean)}` : ""}`
            : undefined
        }
      />
    </div>
  );
}

function PelletTile({ view, previousLabel }: { view: HeatingView; previousLabel: string }) {
  const { current, previous, bagKg } = view;
  const bags = (kg: number) => kg / bagKg;
  return (
    <KpiTile
      icon="flame"
      tone="pellet"
      label="Granulés versés"
      value={formatNumber(bags(current.fuels.pellet?.qty ?? 0))}
      unit="sacs"
      sub={
        previous?.fuels.pellet
          ? `${previousLabel} : ${formatNumber(bags(previous.fuels.pellet.qty))} sacs`
          : `${formatNumber(current.fuels.pellet?.qty ?? 0)} kg`
      }
    />
  );
}

/** « granulés, bois et radiateurs ». */
const list = (items: string[]) =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} et ${items.at(-1)}`;

const coldLabel = (t: number | null) =>
  t === null ? "" : t < 5 ? "très froid" : t < 10 ? "froid" : t < 15 ? "frais" : "doux";

/** Plafond « rond » de l'axe des euros : 20, 40, 50, 80, 100, 200… */
function niceMax(cents: number) {
  const euros = Math.max(10, cents / 100);
  const mag = 10 ** Math.floor(Math.log10(euros));
  const step = [1, 2, 4, 5, 8, 10].map((m) => m * mag).find((v) => v >= euros) ?? euros;
  return step * 100;
}

/**
 * Coût de chauffe de toute la saison, mois par mois (les mois à venir restent vides), face à la
 * saison précédente en barres hachurées ; sous chaque mois, le coût et une jauge « froid ».
 */
export function HeatingCostCard({ view }: { view: HeatingView }) {
  const { seasonMonths, months, modules, current, previous, partialMonth } = view;
  const sources = SOURCES.filter((s) => (s.key === "electric" ? modules.electric : modules[s.key]));
  const centsOf = (m: HeatingView["months"][number], key: (typeof SOURCES)[number]["key"]) =>
    key === "electric" ? m.electricCents : key === "pellet" ? m.pelletCents : m.woodCents;
  const unpriced = current.cost.unpricedFuels;
  const byKey = new Map(months.map((m) => [m.key, m]));
  const hasPrevious = previous !== null;
  const max = niceMax(
    Math.max(...seasonMonths.flatMap((m) => [m.cents ?? 0, m.previousCents ?? 0]), 0),
  );
  const maxDju = Math.max(...seasonMonths.flatMap((m) => [m.dju ?? 0, m.previousDju ?? 0]), 1);
  const y0 = Number(view.season.label.slice(0, 4));
  const y1 = Number(view.season.label.slice(-4));
  const previousLabel = y0 === y1 ? String(y0 - 1) : `${y0 - 1}–${y1 - 1}`;
  const tracked = sources.map((s) => s.label.toLowerCase());
  const missingWood = modules.pellet && !modules.wood ? " (bois non suivi)" : "";
  const kwhPerDju = current.dju && current.dju > 0 ? current.cost.kwh / current.dju : null;
  const previousKwhPerDju =
    previous?.dju && previous.dju > 0 ? previous.cost.kwh / previous.dju : null;
  const coldGap =
    kwhPerDju !== null && previousKwhPerDju !== null ? kwhPerDju / previousKwhPerDju - 1 : null;

  return (
    <section
      aria-labelledby="cout-mois"
      className="flex flex-col gap-5 rounded-card border border-border bg-surface p-6 sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex max-w-xl flex-col gap-1">
          <h2 id="cout-mois" className="text-[15px] font-bold">
            Coût de chauffe par mois
          </h2>
          <p className="text-sm text-muted text-pretty first-letter:uppercase">
            {tracked.length > 0 ? `${list(tracked)}${missingWood}` : "Chauffage"}
            {hasPrevious ? ", cette saison face à la précédente" : ""}.
            {!view.noLocation &&
              " Sous chaque mois, une jauge : plus elle est remplie, plus il a fait froid."}
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-ink-soft">
          {hasPrevious && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="wu-hatch-neutral size-2.5 rounded-[3px]" />
              Saison {previousLabel} (tout compris)
            </li>
          )}
          {sources.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className={`size-2.5 rounded-[3px] ${s.color}`} />
              {s.label} {view.season.label}
              <span className="font-semibold text-ink tabular-nums">
                {eur(current.cost.byFuel[s.key]?.cents ?? 0)}
              </span>
            </li>
          ))}
          {!view.noLocation && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-1.5 w-4 rounded-full bg-ink-soft" />
              Froid du mois
            </li>
          )}
        </ul>
      </div>
      {unpriced.length > 0 && (
        <Notice title="Coût incomplet :">
          aucun achat chiffré pour {unpriced.map((f) => FUEL_LABELS[f].toLowerCase()).join(" et ")}.
          Renseignez le prix de vos achats pour l&apos;inclure.
        </Notice>
      )}
      {view.snapshotFuels.length > 0 && (
        <Notice tone="info" title="Pas de détail mensuel">
          pour {view.snapshotFuels.map((f) => FUEL_LABELS[f].toLowerCase()).join(" et ")} : la
          consommation est estimée par vos relevés de stock. Saisissez les sacs versés pour la
          suivre mois par mois.
        </Notice>
      )}
      <div className="flex gap-2" aria-hidden>
        <div className="relative h-[180px] w-12 flex-none text-[13px] text-muted tabular-nums">
          <span className="absolute top-0 right-0 -translate-y-1/2">{eur(max)}</span>
          <span className="absolute top-1/2 right-0 -translate-y-1/2">{eur(max / 2)}</span>
        </div>
        <div className="relative h-[180px] flex-1 border-b border-border-strong">
          <div className="absolute inset-x-0 top-0 border-t border-track" />
          <div className="absolute inset-x-0 top-1/2 border-t border-track" />
          <div className="absolute inset-0 flex items-end gap-2 sm:gap-4">
            {seasonMonths.map((m) => {
              const f = byKey.get(m.key);
              const h = (cents: number) => `${(cents / max) * 100}%`;
              return (
                <div
                  key={m.key}
                  className="flex h-full min-w-0 flex-1 items-end justify-center gap-1"
                >
                  {hasPrevious && m.previousCents !== null && (
                    <span
                      className="wu-hatch-neutral wu-grow-y block w-[40%] rounded-t-[4px]"
                      style={{ height: h(m.previousCents) }}
                    />
                  )}
                  <span className="flex h-full w-[40%] flex-col-reverse">
                    {f &&
                      sources.map((s, i) => (
                        <span
                          key={s.key}
                          className={`wu-grow-y block ${s.color} ${
                            i === sources.length - 1
                              ? "rounded-t-[4px]"
                              : "border-t-2 border-surface"
                          }`}
                          style={{ height: h(centsOf(f, s.key)) }}
                        />
                      ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <ol className="flex gap-2 pl-14 sm:gap-4">
        {seasonMonths.map((m) => (
          <li
            key={m.key}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 text-center ${
              m.elapsed ? "" : "text-muted"
            }`}
          >
            <span className="text-sm font-semibold capitalize">{shortMonth(m.key)}</span>
            <span className="text-[13px] text-ink-soft tabular-nums">
              {m.cents === null ? "—" : eur(m.cents)}
            </span>
            {!view.noLocation && (
              <>
                <span
                  aria-hidden
                  className="block h-1.5 w-full rounded-full bg-track"
                  title="Froid du mois"
                >
                  <span
                    className="block h-1.5 rounded-full bg-ink-soft"
                    style={{ width: `${((m.dju ?? 0) / maxDju) * 100}%` }}
                  />
                </span>
                <span className="min-h-4 text-[13px] text-ink-soft">
                  {m.dju !== null ? coldLabel(m.tMean) : ""}
                </span>
              </>
            )}
          </li>
        ))}
      </ol>
      {view.noLocation && (
        <Notice
          tone="info"
          title="Pas de météo :"
          action={
            <Link href={settingsHref("localisation")} className={button.secondary}>
              Renseigner ma commune
            </Link>
          }
        >
          renseignez votre commune pour mettre le chauffage en regard du froid.
        </Notice>
      )}
      {partialMonth ? (
        <p className="rounded-control bg-bg px-3.5 py-3 text-sm text-ink-soft text-pretty">
          <span className="capitalize">{monthLabel(partialMonth.key).split(" ")[0]}</span>{" "}
          n&apos;est pas terminé : <strong className="text-ink">{eur(partialMonth.cents)}</strong>{" "}
          au {partialMonth.day}
          {partialMonth.previousSameDateCents !== null && (
            <>
              , contre{" "}
              <strong className="text-ink">{eur(partialMonth.previousSameDateCents)}</strong> à la
              même date l&apos;an dernier
              {partialMonth.previousFullCents !== null &&
                ` (${eur(partialMonth.previousFullCents)} sur tout le mois)`}
            </>
          )}
          .
          {coldGap !== null && Math.abs(coldGap) >= 0.1 && (
            <>
              {" "}
              À froid égal, il vous a fallu {formatPercent(Math.abs(coldGap))} de chaleur{" "}
              {coldGap < 0 ? "en moins" : "en plus"}.
            </>
          )}
        </p>
      ) : (
        previous && (
          <p className="rounded-control bg-bg px-3.5 py-3 text-sm text-ink-soft text-pretty">
            Saison {view.season.label} :{" "}
            <strong className="text-ink">{eur(current.cost.totalCents)}</strong>, contre{" "}
            <strong className="text-ink">{eur(previous.cost.totalCents)}</strong> la saison
            précédente.
            {coldGap !== null && Math.abs(coldGap) >= 0.1 && (
              <>
                {" "}
                À froid égal, il vous a fallu {formatPercent(Math.abs(coldGap))} de chaleur{" "}
                {coldGap < 0 ? "en moins" : "en plus"}.
              </>
            )}
          </p>
        )
      )}
    </section>
  );
}
