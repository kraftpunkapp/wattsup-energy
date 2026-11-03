import Link from "next/link";
import type { ReactNode } from "react";
import { SolarChart } from "@/components/cards/solar-chart";

import { PeriodLink } from "@/components/period-transition";
import {
  ArrowLink,
  Badge,
  Banner,
  button,
  Card,
  Gauge,
  Icon,
  Legend,
  Notice,
  segmented,
  StatTile,
  tiles,
} from "@/components/ui";
import { CATEGORY_SWATCH, CategoryTile, categoryColor } from "@/components/ui/category";
import { monthLabel } from "@/domain/overview";
import { PAYMENT_NOTICE_GAP, type PaymentAnalysis } from "@/domain/tariff/payment";
import { addDays } from "@/lib/time";
import { formatEurFromCents, formatKwh, formatNumber, formatPercent } from "@/lib/format";
import type { ContractComparison } from "@/server/queries/contracts";
import type { Overview } from "@/server/queries/overview";
import { settingsHref } from "@/lib/settings-tabs";

// Cartes de la Vue d'ensemble (T20), sur les briques partagées (SPEC §2).

type Ok = Extract<Overview, { status: "ok" }>;

const eur = (cents: number) => formatEurFromCents(cents, 0);

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

/** Sélecteur mois / année et navigation ‹ › (liens : la période est dans l'URL). */
export function PeriodSwitcher({ overview }: { overview: Ok }) {
  const { period, nav } = overview;
  const arrow = (key: string | null, label: string, path: string) =>
    key ? (
      <PeriodLink
        href={`/?p=${key}`}
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
      <div role="tablist" aria-label="Période" className={segmented.group}>
        <PeriodLink
          role="tab"
          selected={period.kind === "month"}
          href={`/?p=${period.kind === "month" ? period.key : addDays(period.to, -1).slice(0, 7)}`}
          className={segmented.base}
          activeClassName={segmented.on}
          inactiveClassName={segmented.off}
        >
          Mois
        </PeriodLink>
        <PeriodLink
          role="tab"
          selected={period.kind === "year"}
          href={`/?p=${period.key.slice(0, 4)}`}
          className={segmented.base}
          activeClassName={segmented.on}
          inactiveClassName={segmented.off}
        >
          Année
        </PeriodLink>
      </div>
      <div className="flex items-center gap-1 rounded-control border border-border bg-surface p-0.5">
        {arrow(nav.prev, "Période précédente", "M15 6l-6 6 6 6")}
        <span className="min-w-24 text-center text-sm font-semibold capitalize">
          {period.label}
        </span>
        {arrow(nav.next, "Période suivante", "M9 6l6 6-6 6")}
      </div>
    </div>
  );
}

/** Budget de la période (électricité au contrat réel ; combustibles à partir de T23). */
export function BudgetCard({ overview }: { overview: Ok }) {
  const { budget, period } = overview;
  if (budget.totalCents === null) {
    return (
      <Notice
        title="Budget non chiffré :"
        action={
          <Link href="/contrats" className={button.primary}>
            Ajouter mon contrat
          </Link>
        }
      >
        aucun contrat d&apos;électricité n&apos;est enregistré. Ajoutez votre contrat actuel avec sa
        date de début pour calculer ce que vous payez.
      </Notice>
    );
  }
  const previous = budget.previousCents;
  const less = previous !== null && previous > 0 ? budget.totalCents <= previous : null;
  const gap = Math.abs(budget.totalCents - (previous ?? 0));
  const ratio = previous && previous > 0 ? budget.totalCents / previous - 1 : null;
  // Période en cours : comparée aux mêmes jours de l'année précédente.
  const previousYear = Number(period.key.slice(0, 4)) - 1;
  const against = !period.complete
    ? "qu'à la même date l'an dernier"
    : period.kind === "month"
      ? `qu'en ${monthLabel(`${previousYear}${period.key.slice(4)}`)}`
      : `qu'en ${previousYear}`;
  const lastDay = addDays(period.to, -1);
  return (
    <section
      aria-label={`Budget · ${period.label}`}
      className="flex flex-col gap-4 rounded-card bg-panel p-6 text-panel-ink sm:p-7"
    >
      <h2 className="text-sm font-normal text-panel-soft">
        <span className="capitalize">{period.label}</span>
        {!period.complete &&
          (period.kind === "month"
            ? ` · du 1er au ${Number(lastDay.slice(8))}`
            : ` · du 1er janvier au ${Number(lastDay.slice(8))} ${monthLabel(lastDay.slice(0, 7)).split(" ")[0]}`)}
      </h2>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <p className="text-[34px] leading-none font-bold tracking-[-0.03em] tabular-nums">
          {eur(budget.totalCents)}
        </p>
        <ul className="flex min-w-48 flex-col gap-2 pb-1.5 text-sm">
          <li className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-3 rounded-[3px] bg-grid shadow-[0_0_0_1px_rgba(255,255,255,0.45)]"
            />
            Électricité consommée
            <strong className="ml-auto pl-3 tabular-nums">{eur(budget.energyCents)}</strong>
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="size-3 rounded-[3px] bg-subscription" />
            Abonnement
            <strong className="ml-auto pl-3 tabular-nums">{eur(budget.subscriptionCents)}</strong>
          </li>
        </ul>
      </div>
      {less !== null && ratio !== null && previous !== null && (
        <p
          className={`flex items-center gap-2.5 rounded-control px-3 py-2 text-sm ${
            less ? "bg-panel-gain text-panel-ink" : "bg-panel-active text-panel-ink"
          }`}
        >
          <span aria-hidden className="text-[15px] leading-none font-bold">
            {less ? "↓" : "↑"}
          </span>
          <span>
            <strong>
              {formatEurFromCents(gap, gap < 1000 ? 2 : 0)} de {less ? "moins" : "plus"}
            </strong>{" "}
            {against} ({eur(previous)}), soit {less ? "−" : "+"}
            {formatPercent(Math.abs(ratio))}
          </span>
        </p>
      )}
      {overview.projection && !period.complete && (
        <Projection projection={overview.projection} year={period.key.slice(0, 4)} />
      )}
      {budget.unknownContractDays > 0 && (
        <p className="text-[13px] text-panel-muted">
          {budget.unknownContractDays} jour{budget.unknownContractDays > 1 ? "s" : ""} sans contrat
          souscrit, estimé{budget.unknownContractDays > 1 ? "s" : ""} au tarif de votre contrat
          actuel.
        </p>
      )}
    </section>
  );
}

/** Estimation de l'année en cours, en pied de la carte Budget (fond sombre). */
function Projection({
  projection: p,
  year,
}: {
  projection: NonNullable<Ok["projection"]>;
  year: string;
}) {
  const previousYear = Number(year) - 1;
  const trend = p.trend - 1;
  return (
    <div className="flex flex-col gap-1 border-t border-panel-active pt-3.5 text-sm text-panel-muted">
      <p className="flex flex-wrap justify-between gap-x-6 gap-y-1">
        <span>
          Estimation pour {year} :{" "}
          <span className="font-semibold whitespace-nowrap text-panel-ink tabular-nums">
            ≈ {eur(p.totalCents)}
          </span>
          {p.lowCents !== null && p.highCents !== null && (
            <span className="whitespace-nowrap tabular-nums">
              {" "}
              (entre {eur(p.lowCents)} et {eur(p.highCents)})
            </span>
          )}
        </span>
        {p.previousTotalCents !== null && (
          <span className="tabular-nums">
            {previousYear} : {eur(p.previousTotalCents)}
          </span>
        )}
      </p>
      <p className="text-[13px] text-pretty">
        Mois restants estimés sur {previousYear}
        {Math.abs(trend) >= 0.005
          ? `, ${trend > 0 ? "+" : "−"}${formatPercent(Math.abs(trend))} comme depuis janvier`
          : ""}
        .
      </p>
    </div>
  );
}

const HC_COLOR = "bg-hc";

/** Part de l'électricité soutirée en heures creuses et en heures pleines (contrat HP/HC ou Tempo). */
export function PeakCard({
  overview,
  actions,
  flat,
}: {
  overview: Ok;
  actions?: ReactNode;
  flat?: boolean;
}) {
  const { peak, period } = overview;
  if (!peak) return null;
  const total = peak.hp.kwh + peak.hc.kwh;
  const parts = [
    { label: "Heures creuses", ...peak.hc, color: HC_COLOR },
    { label: "Heures pleines", ...peak.hp, color: "bg-grid" },
  ];
  return (
    <Card
      flat={flat}
      title="Heures pleines et heures creuses"
      actions={actions}
      badges={<Badge tone="soft">{formatPercent(peak.hc.kwh / total)} en HC</Badge>}
      description={<span className="capitalize">{period.label}</span>}
    >
      <div className="flex h-9 gap-[2px] overflow-hidden rounded-[8px]" aria-hidden>
        {parts
          .filter((p) => p.kwh > 0)
          .map((p) => (
            <div
              key={p.label}
              className={p.color}
              style={{ width: `${(p.kwh / total) * 100}%` }}
              title={`${p.label} : ${formatPercent(p.kwh / total)}`}
            />
          ))}
      </div>
      <ul className="flex flex-col gap-2.5 text-[13px]">
        {parts.map((p) => (
          <li
            key={p.label}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5"
          >
            <span className="flex items-center gap-2 text-ink-soft">
              <span className={`size-2 rounded-[2px] ${p.color}`} />
              {p.label}
            </span>
            <span className="tabular-nums">
              <span className="font-semibold">{formatPercent(p.kwh / total)}</span>
              <span className="text-subtle">
                {" "}
                · {formatKwh(p.kwh)} · {eur(p.energyCents)}
                {p.kwh > 0 && <> · {formatEurFromCents(p.energyCents / p.kwh, 3)}/kWh</>}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {(peak.otherKwh > 0 || peak.approximated) && (
        <p className="text-[11px] text-subtle text-pretty">
          {peak.otherKwh > 0 &&
            `${formatKwh(peak.otherKwh)} soutirés sous un contrat sans heures creuses ne sont pas comptés. `}
          {peak.approximated &&
            "Une partie des kWh, reçus en totaux quotidiens, est répartie selon vos plages creuses."}
        </p>
      )}
    </Card>
  );
}

const days = (from: string, to: string) =>
  Math.max(
    1,
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5),
  );

/** Bloc d'origine : trois présentations selon l'équipement (installation, heures creuses, Base). */
function OriginShell({
  title,
  aside,
  children,
}: {
  title: string;
  aside: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-bold">{title}</h2>
        <span className="text-sm text-muted tabular-nums">{aside}</span>
      </div>
      {children}
    </section>
  );
}

const Big = ({ value, label }: { value: string; label: string }) => (
  <p className="flex flex-wrap items-baseline gap-x-3">
    <span className="text-[28px] leading-none font-bold tracking-[-0.02em] tabular-nums">
      {value}
    </span>
    <span className="text-[15px] text-ink-soft">{label}</span>
  </p>
);

const Note = ({ children }: { children: ReactNode }) => (
  <p className="rounded-control bg-bg px-3.5 py-3 text-sm text-ink-soft text-pretty">{children}</p>
);

/** D'où vient l'énergie consommée : réseau, solaire direct, batterie, ou à défaut quand on consomme. */
export function OriginCard({
  overview,
  solar,
  battery,
}: {
  overview: Ok;
  solar: boolean;
  battery: boolean;
}) {
  const { balance: b, peak, budget, period } = overview;
  const total = b.consumption;
  if (total <= 0) {
    return (
      <OriginShell title="D'où vient votre électricité" aside={period.label}>
        <p className="text-sm text-muted">Aucune consommation sur cette période.</p>
      </OriginShell>
    );
  }
  const share = (kwh: number) => formatPercent(kwh / total);

  if (solar || battery) {
    const parts = [
      ...(solar ? [{ label: "Solaire", kwh: b.origin.solar, color: "bg-solar" }] : []),
      ...(battery ? [{ label: "Batterie", kwh: b.origin.battery, color: "bg-battery" }] : []),
      { label: "Réseau", kwh: b.origin.grid, color: "bg-grid" },
    ];
    const home = (b.origin.solar + b.origin.battery) / total;
    return (
      <OriginShell title="D'où vient votre électricité" aside={`${formatKwh(total)} consommés`}>
        <Big value={formatPercent(home)} label="produits chez vous" />
        <Gauge
          parts={parts.map((p) => ({ value: p.kwh, color: p.color }))}
          label={parts.map((p) => `${p.label} ${share(p.kwh)}`).join(", ")}
        />
        <Legend
          columns={parts.length === 3 ? 3 : 2}
          items={parts.map((p) => ({ color: p.color, label: p.label, value: formatKwh(p.kwh) }))}
        />
        <div className="mt-auto flex flex-col gap-2">
          {solar && b.solar > 0 && (
            <Note>
              <strong className="text-ink">{formatKwh(b.solar)} produits</strong>
              {b.selfConsumptionRate !== null &&
                `, dont ${formatPercent(b.selfConsumptionRate)} utilisés sur place`}
              {!battery && b.gridExport > 0 && (
                <>
                  {" "}
                  ·{" "}
                  <strong className="text-ink">
                    {formatKwh(b.gridExport)} partis sur le réseau
                  </strong>{" "}
                  sans être utilisés ({formatPercent(b.gridExport / b.solar)} de la production)
                </>
              )}
            </Note>
          )}
          {battery && (
            <Note>
              La batterie ne produit rien : elle rend plus tard ce qu&apos;elle a stocké.
              {b.batteryCharge > 0 && ` Chargée de ${formatKwh(b.batteryCharge)} sur la période.`}
            </Note>
          )}
          {solar && !battery && b.gridExport > 0 && (
            <Link
              href="/rentabilite"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold"
            >
              Que rapporterait une batterie ? Simuler
              <Icon name="arrowRight" size={16} />
            </Link>
          )}
        </div>
      </OriginShell>
    );
  }

  const pricePerKwh = budget.energyCents > 0 ? budget.energyCents / total : null;
  if (peak) {
    const sum = peak.hp.kwh + peak.hc.kwh;
    const rate = (p: { kwh: number; energyCents: number }) =>
      p.kwh > 0 ? formatEurFromCents(p.energyCents / p.kwh, 3) : null;
    const hpRate = peak.hp.kwh > 0 ? peak.hp.energyCents / peak.hp.kwh : null;
    const hcRate = peak.hc.kwh > 0 ? peak.hc.energyCents / peak.hc.kwh : null;
    const shifted =
      hpRate !== null && hcRate !== null ? peak.hp.kwh * 0.1 * (hpRate - hcRate) : null;
    return (
      <OriginShell title="Quand vous consommez" aside={`${formatKwh(sum)} achetés`}>
        <Big value={formatPercent(peak.hc.kwh / sum)} label="en heures creuses" />
        <Gauge
          parts={[
            { value: peak.hc.kwh, color: "bg-hc" },
            { value: peak.hp.kwh, color: "bg-grid" },
          ]}
          label={`Heures creuses ${formatPercent(peak.hc.kwh / sum)}, heures pleines ${formatPercent(peak.hp.kwh / sum)}`}
        />
        <Legend
          columns={2}
          items={[
            {
              color: "bg-hc",
              label: `Heures creuses${rate(peak.hc) ? ` · ${rate(peak.hc)} €` : ""}`,
              value: `${formatKwh(peak.hc.kwh)} · ${eur(peak.hc.energyCents)}`,
            },
            {
              color: "bg-grid",
              label: `Heures pleines${rate(peak.hp) ? ` · ${rate(peak.hp)} €` : ""}`,
              value: `${formatKwh(peak.hp.kwh)} · ${eur(peak.hp.energyCents)}`,
            },
          ]}
        />
        <div className="mt-auto flex flex-col gap-2">
          {pricePerKwh !== null && (
            <Note>
              Prix moyen payé :{" "}
              <strong className="text-ink">{formatEurFromCents(pricePerKwh, 3)} €/kWh</strong>
            </Note>
          )}
          {shifted !== null && shifted >= 50 && (
            <Note>
              Passer 10 % de vos heures pleines en heures creuses :{" "}
              <strong className="text-ink">≈ {eur(shifted)} de moins</strong> sur cette période
            </Note>
          )}
        </div>
      </OriginShell>
    );
  }

  return (
    <OriginShell
      title="Votre consommation"
      aside={<span className="capitalize">{period.label}</span>}
    >
      <Big
        value={formatKwh(total)}
        label={`soit ${formatNumber(total / days(period.from, period.to), 1)} kWh par jour`}
      />
      {pricePerKwh !== null && (
        <Legend
          columns={2}
          items={[
            {
              color: "bg-grid",
              label: "Prix du kWh",
              value: `${formatEurFromCents(pricePerKwh, 3)} €`,
            },
          ]}
        />
      )}
      <Link
        href="/contrats"
        className="mt-auto inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold"
      >
        Comparer les offres
        <Icon name="arrowRight" size={16} />
      </Link>
    </OriginShell>
  );
}

type CategoryItem = Ok["categories"][number];

/** Une ligne de poste : pastille, nom, kWh et part de la conso, barre relative au plus gros. */
function CategoryLine({
  icon,
  color,
  name,
  kwh,
  max,
  consumption,
  extra,
}: {
  icon: string | null;
  color: string | null;
  name: string;
  kwh: number;
  max: number;
  consumption: number;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <CategoryTile icon={icon} color={color} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-[13px]">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{name}</span>
            {extra}
          </span>
          <span className="flex-none tabular-nums">
            <span className="font-semibold">{formatKwh(kwh)}</span>
            {consumption > 0 && (
              <span className="text-subtle"> · {formatPercent(kwh / consumption)}</span>
            )}
          </span>
        </div>
        <div className="h-1 rounded-full bg-track">
          <div
            className={`h-1 rounded-full ${CATEGORY_SWATCH[categoryColor(color)].bg}`}
            style={{ width: max > 0 ? `${(kwh / max) * 100}%` : 0 }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Postes de consommation : kWh de la période et part de la consommation du foyer. Les
 * postes de chauffage (au moins deux) sont additionnés sur une ligne repliée, à déplier.
 */
export function CategoriesOverviewCard({ overview, flat }: { overview: Ok; flat?: boolean }) {
  const { categories, balance, period } = overview;
  const heating = categories.filter((c) => c.isHeating);
  const grouped = heating.length >= 2;
  const heatingKwh = heating.reduce((a, c) => a + c.kwh, 0);
  const rows: ({ kind: "one"; c: CategoryItem } | { kind: "heating"; kwh: number })[] = [
    ...categories.filter((c) => !grouped || !c.isHeating).map((c) => ({ kind: "one" as const, c })),
    ...(grouped ? [{ kind: "heating" as const, kwh: heatingKwh }] : []),
  ].sort((a, b) => (b.kind === "one" ? b.c.kwh : b.kwh) - (a.kind === "one" ? a.c.kwh : a.kwh));
  const max = Math.max(...rows.map((r) => (r.kind === "one" ? r.c.kwh : r.kwh)), 0);
  const consumption = balance.consumption;
  return (
    <Card
      flat={flat}
      title="Postes de consommation"
      description={period.label}
      actions={
        <Link href={settingsHref("postes")} className={`${button.link} pt-0.5`}>
          Gérer
        </Link>
      }
    >
      {categories.length === 0 ? (
        <Notice
          tone="info"
          title="Aucun poste suivi."
          action={
            <Link href={settingsHref("postes")} className={button.secondary}>
              Créer un poste
            </Link>
          }
        >
          Suivez un appareil ou un circuit (chauffe-eau, chauffage, véhicule…) pour voir sa part
          dans votre consommation.
        </Notice>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) =>
            r.kind === "one" ? (
              <li key={r.c.id}>
                <CategoryLine
                  {...r.c}
                  max={max}
                  consumption={consumption}
                  extra={r.c.isHeating && <Badge tone="warning">Chauffage</Badge>}
                />
              </li>
            ) : (
              <li key="heating">
                {/* Repliée par défaut (balise native : aucun script nécessaire). */}
                <details className="group">
                  <summary className="cursor-pointer list-none rounded-[8px] [&::-webkit-details-marker]:hidden">
                    <CategoryLine
                      icon="flame"
                      color="eheat"
                      name="Chauffage"
                      kwh={r.kwh}
                      max={max}
                      consumption={consumption}
                      extra={
                        <span className="flex items-center gap-1 text-xs text-subtle">
                          {heating.length} postes
                          <span className="transition-transform group-open:rotate-90">
                            <Icon name="chevron" size={14} />
                          </span>
                        </span>
                      }
                    />
                  </summary>
                  <ul className="mt-3 ml-4 flex flex-col gap-3 border-l border-track pl-3">
                    {[...heating]
                      .sort((a, b) => b.kwh - a.kwh)
                      .map((c) => (
                        <li key={c.id}>
                          <CategoryLine {...c} max={max} consumption={consumption} />
                        </li>
                      ))}
                  </ul>
                </details>
              </li>
            ),
          )}
        </ul>
      )}
      {flat && (
        <Link href={settingsHref("postes")} className={`${button.link} self-start`}>
          Gérer les postes
        </Link>
      )}
    </Card>
  );
}

const fmtYield = (y: number) => y.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

// Repère de la tuile Ensoleillement : couleur de la courbe du graphique.
const SUNSHINE_DOT = "bg-ink-soft";

/**
 * Production et ensoleillement : barres de production et courbe d'ensoleillement superposée
 * (chacune sur sa propre échelle, dont la valeur du haut est indiquée de chaque côté ;
 * valeurs dans l'info-bulle), et le rendement kWh produits
 * par kWh/m² reçu, comparé à N-1.
 */
export function SolarCard({ overview, flat }: { overview: Ok; flat?: boolean }) {
  const { solar, period } = overview;
  if (!solar) return null;
  const byMonth = period.kind === "year";
  const sunshine = solar.points.reduce((a, p) => a + (p.sunshineHours ?? 0), 0);
  const delta =
    solar.yield !== null && solar.previousYield ? solar.yield / solar.previousYield - 1 : null;
  return (
    <Card
      flat={flat}
      icon="sun"
      title="Production et ensoleillement"
      description={<span className="capitalize">{period.label}</span>}
    >
      <div className={tiles}>
        <StatTile label="Production" value={formatNumber(solar.kwh)} unit="kWh" dot="bg-solar" />
        <StatTile
          label="Ensoleillement"
          value={formatNumber(sunshine)}
          unit="h"
          dot={SUNSHINE_DOT}
        />
        <StatTile
          label="Rendement"
          value={solar.yield !== null ? fmtYield(solar.yield) : "—"}
          unit="kWh par kWh/m²"
          sub={
            delta !== null
              ? `${delta >= 0 ? "+" : "−"}${formatPercent(Math.abs(delta))} vs l'an dernier`
              : "pas de comparaison N-1"
          }
        />
      </div>
      {solar.noLocation && (
        <Notice
          tone="info"
          title="Pas de météo :"
          action={
            <Link href={settingsHref("localisation")} className={button.secondary}>
              Renseigner ma commune
            </Link>
          }
        >
          renseignez votre commune pour mettre la production en regard de l&apos;ensoleillement.
        </Notice>
      )}
      {solar.kwh === 0 ? (
        <p className="text-sm text-muted">
          Aucune production solaire reçue sur cette période. Vérifiez que le capteur de production
          est bien renseigné dans l&apos;automatisation Home Assistant.
        </p>
      ) : (
        <SolarChart
          points={solar.points}
          byMonth={byMonth}
          periodLabel={period.label}
          year={period.key.slice(0, 4)}
          noLocation={solar.noLocation}
        />
      )}
    </Card>
  );
}

/** Économie minimale (par an) pour suggérer un autre contrat, et historique minimal. */
const SWITCH_MIN_CENTS = 3000;
const SWITCH_MIN_DAYS = 90;

/**
 * Un contrat simulé (ou de référence) aurait coûté nettement moins cher que l'actuel sur
 * la consommation réelle des 12 derniers mois (T45) : encart vers Contrats.
 */
export function CheaperContractNotice({
  comparison,
  hide,
}: {
  comparison: ContractComparison;
  /** Bouton « Masquer » (Vue d'ensemble personnalisable). */
  hide?: ReactNode;
}) {
  if (comparison.status !== "ok" || comparison.periodDays < SWITCH_MIN_DAYS) return null;
  const best = comparison.rows[0];
  const current = comparison.rows.find((r) => r.isCurrent);
  if (!best || !current || best.id === current.id) return null;
  const saving = current.annualCents - best.annualCents;
  if (saving < SWITCH_MIN_CENTS) return null;
  const partial = comparison.periodDays < 365;
  return (
    <Notice
      tone="info"
      title={`« ${best.name} » vous aurait coûté ${eur(saving)} de moins`}
      action={
        <>
          <Link href="/contrats" className={`${button.secondary} bg-surface text-ink no-underline`}>
            Comparer les contrats
          </Link>
          {hide}
        </>
      }
    >
      {partial
        ? `par an que votre contrat actuel, d'après vos ${comparison.periodDays} derniers jours de consommation.`
        : "sur les 12 derniers mois, par rapport à votre contrat actuel, avec la même consommation."}
    </Notice>
  );
}

/**
 * Mensualité à revoir (T59, SPEC §7.13), en bandeau : seulement si le prélevé sur l'année
 * s'écarte de plus de 10 % du coût attendu ; le détail est sur la carte du contrat en cours.
 */
export function PaymentBanner({
  payment,
  hide,
}: {
  payment: { amountCents: number; analysis: PaymentAnalysis } | null;
  hide?: ReactNode;
}) {
  const a = payment?.analysis;
  if (!payment || a?.status !== "ok" || Math.abs(a.gap) <= PAYMENT_NOTICE_GAP) return null;
  const s = a.settlement;
  return (
    <Banner
      actions={
        <>
          <ArrowLink href="/contrats">Voir le contrat</ArrowLink>
          {hide}
        </>
      }
    >
      <p>
        <strong>Mensualité :</strong> ≈ {eur(a.advisedCents)} par mois{" "}
        {a.gap > 0 ? "suffiraient" : "seraient nécessaires"} au lieu de {eur(payment.amountCents)},
        d&apos;après vos 12 derniers mois.
        {s &&
          ` Régularisation de ${monthLabel(s.month)} estimée : environ ${eur(Math.abs(s.balanceCents))} ${
            s.balanceCents > 0 ? "à payer" : "en votre faveur"
          }.`}{" "}
        <span className="opacity-80">
          Estimation, à confirmer auprès de votre fournisseur.
        </span>
      </p>
    </Banner>
  );
}
