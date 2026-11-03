import Link from "next/link";
import { StackedBars } from "@/components/charts/stacked-bars";
import { PeriodLink } from "@/components/period-transition";
import { Badge, button, Card, Notice, StatTile } from "@/components/ui";
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
        <span className="min-w-36 text-center text-[15px] font-semibold">
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
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-2">
      <StatTile
        standalone
        label="Coût de la saison"
        value={formatNumber(current.cost.totalCents / 100)}
        unit="€"
        sub={deltaText(delta(current.cost.totalCents, previous?.cost.totalCents), previousLabel)}
      />
      {modules.pellet && <PelletTile view={view} previousLabel={previousLabel} />}
      {modules.wood && (
        <StatTile
          standalone
          label="Bois brûlé"
          value={formatNumber(current.fuels.wood?.qty ?? 0, 1)}
          unit="stères"
          dot="bg-wood"
          sub={
            previous?.fuels.wood
              ? `${previousLabel} : ${formatNumber(previous.fuels.wood.qty, 1)} st.`
              : undefined
          }
        />
      )}
      {modules.electric && (
        <StatTile
          standalone
          label="Radiateurs"
          value={formatNumber(current.electricKwh)}
          unit="kWh"
          dot="bg-eheat"
          sub={
            previous ? `${previousLabel} : ${formatNumber(previous.electricKwh)} kWh` : undefined
          }
        />
      )}
      <StatTile
        standalone
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
    <StatTile
      standalone
      label="Granulés versés"
      value={formatNumber(bags(current.fuels.pellet?.qty ?? 0))}
      unit="sacs"
      dot="bg-pellet"
      sub={
        previous?.fuels.pellet
          ? `${previousLabel} : ${formatNumber(bags(previous.fuels.pellet.qty))} sacs`
          : `${formatNumber(current.fuels.pellet?.qty ?? 0)} kg`
      }
    />
  );
}

/** Coût mensuel par source, degrés-jours en dessous, équivalence kWh. */
export function HeatingCostCard({ view }: { view: HeatingView }) {
  const { months, modules, current, previous } = view;
  const sources = SOURCES.filter((s) => (s.key === "electric" ? modules.electric : modules[s.key]));
  const centsOf = (m: HeatingView["months"][number], key: (typeof SOURCES)[number]["key"]) =>
    key === "electric" ? m.electricCents : key === "pellet" ? m.pelletCents : m.woodCents;
  const kwhPerDju = current.dju && current.dju > 0 ? current.cost.kwh / current.dju : null;
  const previousKwhPerDju =
    previous?.dju && previous.dju > 0 ? previous.cost.kwh / previous.dju : null;
  const unpriced = current.cost.unpricedFuels;

  return (
    <Card
      icon="flame"
      title="Coût de chauffe par mois"
      description="Électricité des postes « chauffage » au contrat en vigueur, combustibles au prix moyen de vos achats des 12 mois précédents."
    >
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
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
        {sources.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-ink-soft">
            <span className={`size-2 rounded-[2px] ${s.color}`} />
            {s.label}
            <span className="font-semibold text-ink tabular-nums">
              {eur(current.cost.byFuel[s.key]?.cents ?? 0)}
            </span>
          </li>
        ))}
      </ul>
      <StackedBars
        ariaLabel={`Coût de chauffe par mois, saison ${view.season.label}`}
        bars={months.map((m) => ({
          key: m.key,
          label: shortMonth(m.key),
          title: `${monthLabel(m.key)} : ${eur(m.electricCents + m.pelletCents + m.woodCents)}${m.tMean !== null ? ` · ${temp(m.tMean)} en moyenne` : ""}`,
          segments: sources.map((s) => ({
            value: centsOf(m, s.key),
            color: s.color,
            label: s.label,
          })),
        }))}
      />
      {!view.noLocation ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">
            Froid du mois : plus la barre est haute, plus il a fait froid
          </span>
          <StackedBars
            height={64}
            ariaLabel={`Degrés-jours par mois, saison ${view.season.label}`}
            bars={months.map((m) => ({
              key: m.key,
              label: shortMonth(m.key),
              title: `${monthLabel(m.key)} : ${m.dju === null ? "météo inconnue" : `${formatNumber(m.dju)} degrés-jours, ${temp(m.tMean ?? 0)} en moyenne`}`,
              segments: [{ value: m.dju ?? 0, color: "bg-neutral-bar", label: "Degrés-jours" }],
            }))}
          />
        </div>
      ) : (
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
      <p className="rounded-control bg-bg px-3 py-2.5 text-xs text-muted text-pretty tabular-nums">
        Chaleur consommée ≈{" "}
        <span className="font-semibold text-ink">{formatNumber(current.cost.kwh)} kWh</span>
        {current.dju !== null && (
          <>
            {" "}
            pour {formatNumber(current.dju)} degrés-jours
            {kwhPerDju !== null && (
              <>
                , soit{" "}
                <span className="font-semibold text-ink">{formatNumber(kwhPerDju, 1)} kWh</span> par
                degré-jour
                {previousKwhPerDju !== null && ` (N-1 : ${formatNumber(previousKwhPerDju, 1)})`}
              </>
            )}
          </>
        )}
        .
      </p>
    </Card>
  );
}
