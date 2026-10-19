import Link from "next/link";
import type { ReactNode } from "react";
import { SolarChart } from "@/components/cards/solar-chart";
import { CoverageBadge } from "@/components/coverage-badge";
import { PeriodLink } from "@/components/period-transition";
import { Badge, button, Card, Icon, Notice, StatTile, tiles } from "@/components/ui";
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

/** Sélecteur mois / année et navigation ‹ › (liens : la période est dans l'URL). */
export function PeriodSwitcher({ overview }: { overview: Ok }) {
  const { period, nav } = overview;
  const segment = {
    className: "rounded-[8px] px-3.5 py-1.5 text-[13px] font-medium",
    activeClassName: "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
    inactiveClassName: "text-ink-soft",
  };
  const arrow = (key: string | null, label: string, path: string) =>
    key ? (
      <PeriodLink href={`/?p=${key}`} aria-label={label} className={button.icon}>
        <span aria-hidden className="text-base leading-none">
          {path}
        </span>
      </PeriodLink>
    ) : (
      <span className={`${button.icon} opacity-40`} aria-hidden>
        <span className="text-base leading-none">{path}</span>
      </span>
    );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="tablist" className="flex gap-1 rounded-[10px] bg-chip p-[3px]">
        <PeriodLink
          role="tab"
          selected={period.kind === "month"}
          href={`/?p=${period.kind === "month" ? period.key : addDays(period.to, -1).slice(0, 7)}`}
          {...segment}
        >
          Mois
        </PeriodLink>
        <PeriodLink
          role="tab"
          selected={period.kind === "year"}
          href={`/?p=${period.key.slice(0, 4)}`}
          {...segment}
        >
          Année
        </PeriodLink>
      </div>
      <div className="flex items-center gap-2">
        {arrow(nav.prev, "Période précédente", "‹")}
        <span className="min-w-32 text-center text-sm font-semibold capitalize">
          {period.label}
        </span>
        {arrow(nav.next, "Période suivante", "›")}
      </div>
      {overview.coverage !== null && (
        <CoverageBadge ratio={overview.coverage} granularity={overview.granularity} />
      )}
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
  const delta =
    budget.previousCents && budget.previousCents > 0
      ? budget.totalCents / budget.previousCents - 1
      : null;
  // Écart en euros ; les centimes seulement sous 10 €, sinon « +0 € » pour un petit écart.
  const gap = Math.abs(budget.totalCents - (budget.previousCents ?? 0));
  // Période en cours : comparée aux mêmes jours de l'année précédente.
  const previousYear = Number(period.key.slice(0, 4)) - 1;
  const previousLabel = !period.complete
    ? `même période ${previousYear}`
    : period.kind === "month"
      ? monthLabel(`${previousYear}${period.key.slice(4)}`)
      : String(previousYear);
  return (
    <section className="flex flex-col gap-4 rounded-card border border-panel-edge bg-panel p-5 text-panel-ink sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] text-panel-muted">
          Budget énergie · <span className="capitalize">{period.label}</span>
        </h2>
        {delta !== null && (
          <span
            className={`text-xs font-medium tabular-nums ${delta <= 0 ? "text-panel-positive" : "text-panel-negative"}`}
          >
            {delta <= 0 ? "−" : "+"}
            {formatEurFromCents(gap, gap < 1000 ? 2 : 0)} · {delta <= 0 ? "−" : "+"}
            {formatPercent(Math.abs(delta))} vs {previousLabel}
          </span>
        )}
      </div>
      <p className="text-[40px] leading-none font-semibold tracking-tight tabular-nums">
        {eur(budget.totalCents)}
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-panel-soft">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-hc" />
          Électricité consommée
          <span className="font-semibold text-panel-ink tabular-nums">
            {eur(budget.energyCents)}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-neutral-bar" />
          Abonnement
          <span className="font-semibold text-panel-ink tabular-nums">
            {eur(budget.subscriptionCents)}
          </span>
        </span>
      </div>
      {overview.projection && !period.complete && (
        <Projection projection={overview.projection} year={period.key.slice(0, 4)} />
      )}
      {budget.unknownContractDays > 0 && (
        <p className="text-[11px] text-panel-muted">
          {budget.unknownContractDays} jour{budget.unknownContractDays > 1 ? "s" : ""} sans contrat
          souscrit, estimé{budget.unknownContractDays > 1 ? "s" : ""} au tarif de votre contrat
          actuel.
        </p>
      )}
    </section>
  );
}

/** « À ce rythme » : dépense projetée de l'année en cours, sur la carte Budget (fond sombre). */
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
    <div className="flex flex-col gap-1 border-t border-panel-ink/10 pt-3">
      <p className="text-[13px] text-panel-soft">
        À ce rythme :{" "}
        <span className="font-semibold whitespace-nowrap text-panel-ink tabular-nums">
          ≈ {eur(p.totalCents)}
        </span>{" "}
        sur {year}
        {p.lowCents !== null && p.highCents !== null && (
          <span className="whitespace-nowrap tabular-nums">
            {" "}
            (entre {eur(p.lowCents)} et {eur(p.highCents)})
          </span>
        )}
        {p.previousTotalCents !== null && (
          <span className="whitespace-nowrap tabular-nums">
            {" "}
            · {previousYear} : {eur(p.previousTotalCents)}
          </span>
        )}
      </p>
      <p className="text-[11px] text-panel-muted text-pretty">
        Mois restants estimés sur {previousYear}
        {Math.abs(trend) >= 0.005
          ? `, ${trend > 0 ? "+" : "−"}${formatPercent(Math.abs(trend))} comme depuis janvier`
          : ""}
        .
      </p>
    </div>
  );
}

/** Chiffres clés de la période, selon le profil. */
export function KpiTiles({
  overview,
  solar,
  battery,
}: {
  overview: Ok;
  solar: boolean;
  battery: boolean;
}) {
  const b = overview.balance;
  return (
    <div className="grid grid-cols-2 gap-2 sm:auto-rows-fr">
      <StatTile
        standalone
        label="Consommation du foyer"
        value={formatNumber(b.consumption)}
        unit="kWh"
      />
      <StatTile
        standalone
        label="Soutiré au réseau"
        value={formatNumber(b.gridImport)}
        unit="kWh"
        dot="bg-grid"
        sub={
          b.consumption > 0
            ? `${formatPercent(b.origin.grid / b.consumption)} de la conso`
            : undefined
        }
      />
      {solar && (
        <StatTile
          standalone
          label="Production solaire"
          value={formatNumber(b.solar)}
          unit="kWh"
          dot="bg-solar"
          sub={
            b.selfConsumptionRate !== null
              ? `${formatPercent(b.selfConsumptionRate)} consommée sur place`
              : undefined
          }
        />
      )}
      {battery && (
        <StatTile
          standalone
          label="Restitué par la batterie"
          value={formatNumber(b.batteryDischarge)}
          unit="kWh"
          dot="bg-battery"
          sub={`chargée ${formatKwh(b.batteryCharge)}`}
        />
      )}
    </div>
  );
}

const HC_COLOR = "bg-hc";

/** Part de l'électricité soutirée en heures creuses et en heures pleines (contrat HP/HC ou Tempo). */
export function PeakCard({ overview, actions }: { overview: Ok; actions?: ReactNode }) {
  const { peak, period } = overview;
  if (!peak) return null;
  const total = peak.hp.kwh + peak.hc.kwh;
  const parts = [
    { label: "Heures creuses", ...peak.hc, color: HC_COLOR },
    { label: "Heures pleines", ...peak.hp, color: "bg-grid" },
  ];
  return (
    <Card
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

/** D'où vient l'énergie consommée : réseau, solaire direct, batterie. */
export function OriginCard({
  overview,
  solar,
  battery,
}: {
  overview: Ok;
  solar: boolean;
  battery: boolean;
}) {
  const b = overview.balance;
  const parts = [
    { label: "Réseau", kwh: b.origin.grid, color: "bg-grid" },
    ...(solar ? [{ label: "Solaire autoconsommé", kwh: b.origin.solar, color: "bg-solar" }] : []),
    ...(battery ? [{ label: "Batterie", kwh: b.origin.battery, color: "bg-battery" }] : []),
  ];
  const total = b.consumption;
  return (
    <Card
      title="Origine de la consommation"
      badges={<Badge>{formatKwh(total)}</Badge>}
      description={overview.period.label}
    >
      {total > 0 ? (
        <>
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
              <li key={p.label} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-ink-soft">
                  <span className={`size-2 rounded-[2px] ${p.color}`} />
                  {p.label}
                </span>
                <span className="tabular-nums">
                  <span className="font-semibold">{formatPercent(p.kwh / total)}</span>
                  <span className="text-subtle"> · {formatKwh(p.kwh)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted">Aucune consommation sur cette période.</p>
      )}
    </Card>
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
export function CategoriesOverviewCard({ overview }: { overview: Ok }) {
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
export function SolarCard({ overview }: { overview: Ok }) {
  const { solar, period } = overview;
  if (!solar) return null;
  const byMonth = period.kind === "year";
  const sunshine = solar.points.reduce((a, p) => a + (p.sunshineHours ?? 0), 0);
  const delta =
    solar.yield !== null && solar.previousYield ? solar.yield / solar.previousYield - 1 : null;
  return (
    <Card
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
 * Mensualité à revoir (T59, SPEC §7.13) : seulement si le prélevé sur l'année s'écarte de plus
 * de 10 % du coût attendu ; le détail est sur la carte du contrat en cours.
 */
export function PaymentNotice({
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
    <Notice
      tone="info"
      title={`Votre mensualité de ${eur(payment.amountCents)} semble trop ${a.gap > 0 ? "élevée" : "basse"}`}
      action={
        <>
          <Link href="/contrats" className={`${button.secondary} bg-surface text-ink no-underline`}>
            Voir le contrat
          </Link>
          {hide}
        </>
      }
    >
      : environ {eur(a.advisedCents)} par mois couvriraient votre consommation des 12 derniers mois.
      {s &&
        ` Régularisation de ${monthLabel(s.month)} estimée : environ ${eur(Math.abs(s.balanceCents))} ${
          s.balanceCents > 0 ? "à payer" : "en votre faveur"
        }.`}
    </Notice>
  );
}
