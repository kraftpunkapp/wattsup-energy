"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Badge, button, Icon, Notice } from "@/components/ui";
import { METER_POWERS } from "@/domain/market/compare";
import { DAY_NAMES } from "@/domain/market/offer";
import { addMarketOfferAction, saveMeterPowerAction } from "@/server/actions/market";

// Comparaison des offres (T18, T55) : un seul classement pour le contrat en cours, les offres
// simulées du foyer, ses anciens contrats (masqués par défaut) et les offres du marché, chacune
// rejouée aux prix d'aujourd'hui sur la consommation des 12 derniers mois. Chaque ligne dit
// d'où vient l'offre ; tout ce qui coûte moins cher que le contrat actuel est en vert.

export type RowOrigin = "current" | "simulated" | "upcoming" | "past" | "market";

export interface ComparedRow {
  key: string;
  origin: RowOrigin;
  name: string;
  /** Fournisseur (offre du marché). */
  provider: string | null;
  /** Précision sur l'origine : « jusqu'au 7 oct. 2026 », « à partir du… ». */
  originDetail: string | null;
  kind: string;
  regulated: boolean;
  annualCents: number;
  /** Écart annuel avec le contrat actuel (négatif = économie) ; null sans contrat actuel. */
  deltaAnnualCents: number | null;
  approximate: boolean;
  assumedTempoDays: number;
  /** Heures sans prix spot connu, estimées au prix moyen. */
  assumedSpotHours: number;
  assumedOffPeak: boolean;
  /** Offre du marché : nom chez la source, grille, lien officiel. */
  market: {
    name: string;
    gridDate: string;
    oldGrid: boolean;
    priceUrl: string | null;
    /** Offre à jour choisi : le jour le moins cher pour le foyer (ISO). */
    chosenDay: number | null;
  } | null;
}

export type MarketState =
  | { status: "none" }
  | { status: "no-power" }
  | {
      status: "ok";
      kva: number;
      pending: { name: string; reason: string }[];
      unavailable: number;
    };

/** En dessous d'un euro par an, deux offres coûtent la même chose. */
const SAME_CENTS = 100;
const TOP_MARKET = 5;
const COMMON_POWERS = [6, 9, 12] as const;
const eur = (cents: number) => `${Math.round(cents / 100).toLocaleString("fr-FR")} €`;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const ORIGIN_LABELS: Record<Exclude<RowOrigin, "current" | "market">, string> = {
  simulated: "Offre simulée",
  upcoming: "Contrat à venir",
  past: "Ancien contrat",
};

function usePower() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (kva: number) =>
    startTransition(async () => {
      const res = await saveMeterPowerAction(kva);
      setError(res.ok ? null : (res.errors[0] ?? "enregistrement impossible"));
    });
  return { pending, error, save };
}

function PowerSelect({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (kva: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      Compteur
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 rounded-[8px] border border-border-strong bg-surface px-2 text-[13px] text-ink tabular-nums outline-none focus:border-ink disabled:opacity-60"
      >
        {value === null && <option value="">Autre…</option>}
        {METER_POWERS.map((p) => (
          <option key={p} value={p}>
            {p} kVA
          </option>
        ))}
      </select>
    </label>
  );
}

function AddButton({ name, chosenDay }: { name: string; chosenDay: number | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await addMarketOfferAction(name, chosenDay);
            setError(res.ok ? null : (res.errors[0] ?? "ajout impossible"));
          })
        }
        className={`${button.link} inline-flex items-center gap-1 font-medium text-ink-soft`}
      >
        <Icon name="plus" size={12} />
        {pending ? "Ajout…" : "Ajouter à mes offres"}
      </button>
      {error && (
        <span role="alert" className="text-negative">
          {error}
        </span>
      )}
    </>
  );
}

function Delta({ row }: { row: ComparedRow }) {
  if (row.origin === "current") return <span className="text-[11px] text-subtle">référence</span>;
  const d = row.deltaAnnualCents;
  if (d === null) return null;
  if (Math.abs(d) < SAME_CENTS) {
    return <span className="text-[11px] font-medium text-subtle">≈ même coût</span>;
  }
  return (
    <span
      className={`text-[11px] font-medium tabular-nums ${d < 0 ? "text-positive" : "text-negative"}`}
    >
      {d < 0 ? "−" : "+"}
      {eur(Math.abs(d))}
    </span>
  );
}

function Line({ row, max }: { row: ComparedRow; max: number }) {
  const cheaper = row.deltaAnnualCents !== null && row.deltaAnnualCents <= -SAME_CENTS;
  const bar = row.origin === "current" ? "bg-grid" : cheaper ? "bg-battery" : "bg-dash";
  const origin =
    row.origin === "market"
      ? row.provider
      : row.origin === "current"
        ? null
        : [ORIGIN_LABELS[row.origin], row.originDetail].filter(Boolean).join(" · ");
  return (
    <li className={`flex flex-col gap-1.5 ${row.origin === "past" ? "opacity-70" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{row.name}</span>
          {origin && <span className="text-xs text-muted">{origin}</span>}
          <Badge>{row.kind}</Badge>
          {row.regulated && <Badge tone="soft">Tarif réglementé</Badge>}
          {row.origin === "current" && <Badge tone="active">En cours</Badge>}
        </span>
        <span className="flex flex-none flex-col items-end">
          <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">
            {eur(row.annualCents)}/an
          </span>
          <Delta row={row} />
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-track">
        <div
          className={`h-1.5 rounded-full ${bar}`}
          style={{ width: `${(row.annualCents / max) * 100}%` }}
        />
      </div>
      {row.market && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
          <span className="flex items-center gap-1.5 tabular-nums">
            Offre du marché · grille du {row.market.gridDate}
            {row.market.oldGrid && <Badge tone="warning">Ancienne</Badge>}
          </span>
          {row.market.priceUrl && (
            <a
              href={row.market.priceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${button.link} inline-flex items-center gap-1`}
            >
              Grille officielle
              <Icon name="external" size={12} />
            </a>
          )}
          <AddButton name={row.market.name} chosenDay={row.market.chosenDay} />
        </div>
      )}
      {row.market?.chosenDay && (
        <span className="text-[11px] text-subtle text-pretty">
          Jour choisi au prix du week-end : le {DAY_NAMES[row.market.chosenDay - 1]}, le moins cher
          pour votre consommation.
        </span>
      )}
      {(row.assumedOffPeak ||
        row.approximate ||
        row.assumedTempoDays > 0 ||
        row.assumedSpotHours > 0) && (
        <span className="text-[11px] text-pellet text-pretty">
          {row.assumedOffPeak &&
            "Heures creuses supposées de 22 h à 6 h (celles de votre compteur sont inconnues). "}
          {row.approximate &&
            "Simulation approximative : passez en envoi horaire pour plus de précision. "}
          {row.assumedTempoDays > 0 &&
            `${plural(row.assumedTempoDays, "jour", "jours")} de couleur inconnue, supposé${row.assumedTempoDays > 1 ? "s" : ""} bleu${row.assumedTempoDays > 1 ? "s" : ""}. `}
          {row.assumedSpotHours > 0 &&
            `${plural(row.assumedSpotHours, "heure", "heures")} sans prix spot connu, estimée${row.assumedSpotHours > 1 ? "s" : ""} au prix moyen.`}
        </span>
      )}
    </li>
  );
}

function NoPowerNotice() {
  const power = usePower();
  return (
    <>
      <Notice
        tone="info"
        title="Comparez aussi les offres du marché :"
        action={
          <>
            {COMMON_POWERS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={power.pending}
                onClick={() => power.save(p)}
                className={button.secondary}
              >
                {p} kVA
              </button>
            ))}
            <PowerSelect value={null} onChange={power.save} disabled={power.pending} />
          </>
        }
      >
        indiquez la puissance de votre compteur (en kVA, sur votre facture ou votre contrat).
      </Notice>
      {power.error && (
        <p role="alert" className="text-xs text-negative">
          {power.error}
        </p>
      )}
    </>
  );
}

export function ComparisonCard({
  rows,
  paid,
  coverage,
  market,
  note,
}: {
  /** Toutes les offres, de la moins chère à la plus chère. */
  rows: ComparedRow[];
  /** Coût réellement payé sur la période ; null sans contrat souscrit. */
  paid: { annualCents: number; unknownContractDays: number; partial: boolean } | null;
  /** Pastille de couverture des données, rendue par le serveur. */
  coverage: ReactNode;
  market: MarketState;
  /** Mentions des offres du marché (avertissement et source), rendues par le serveur. */
  note: ReactNode;
}) {
  const power = usePower();
  const [allMarket, setAllMarket] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const marketRows = rows.filter((r) => r.origin === "market");
  const topMarket = new Set(marketRows.slice(0, TOP_MARKET).map((r) => r.key));
  const past = rows.filter((r) => r.origin === "past").length;
  const shown = rows.filter(
    (r) =>
      (r.origin !== "past" || showPast) &&
      (r.origin !== "market" || allMarket || topMarket.has(r.key)),
  );
  const max = Math.max(...shown.map((r) => r.annualCents), 1);
  const hasCurrent = rows.some((r) => r.origin === "current");

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <h2 className="text-[15px] font-semibold">Comparez votre contrat</h2>
          {coverage}
        </div>
        <p className="text-xs text-muted text-pretty">
          {market.status === "ok"
            ? "Vos offres simulées et celles des fournisseurs"
            : "Vos offres simulées"}
          , aux prix d&apos;aujourd&apos;hui, sur votre consommation des 12 derniers mois
          {hasCurrent ? " ; écart avec votre contrat actuel." : "."}
        </p>
      </div>

      {market.status === "ok" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PowerSelect value={market.kva} onChange={power.save} disabled={power.pending} />
          {power.error && (
            <p role="alert" className="text-xs text-negative">
              {power.error}
            </p>
          )}
        </div>
      )}

      {paid && (
        <div className="flex items-center justify-between gap-2 rounded-[10px] bg-bg px-3 py-2.5">
          <span className="flex flex-col">
            <span className="text-[13px] font-medium">
              Payé sur {paid.partial ? "la période" : "les 12 derniers mois"}
            </span>
            <span className="text-[11px] text-subtle text-pretty">
              avec chacun de vos contrats et ses prix de l&apos;époque, jour par jour
              {paid.unknownContractDays > 0 &&
                ` · ${paid.unknownContractDays} j sans contrat, estimés au tarif actuel`}
            </span>
          </span>
          <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">
            {eur(paid.annualCents)}/an
          </span>
        </div>
      )}

      <ul className={`flex flex-col gap-3 ${power.pending ? "opacity-50" : ""}`}>
        {shown.map((r) => (
          <Line key={r.key} row={r} max={max} />
        ))}
      </ul>

      {(marketRows.length > TOP_MARKET || past > 0) && (
        <div className="flex flex-wrap gap-2">
          {marketRows.length > TOP_MARKET && (
            <button
              type="button"
              onClick={() => setAllMarket(!allMarket)}
              aria-expanded={allMarket}
              className={button.secondary}
            >
              {allMarket
                ? `Les ${TOP_MARKET} offres du marché les moins chères`
                : `Voir les ${marketRows.length} offres du marché`}
            </button>
          )}
          {past > 0 && (
            <button
              type="button"
              onClick={() => setShowPast(!showPast)}
              aria-expanded={showPast}
              className={button.secondary}
            >
              {showPast
                ? "Masquer les anciens contrats"
                : `Voir ${past > 1 ? `vos ${past} anciens contrats` : "votre ancien contrat"}`}
            </button>
          )}
        </div>
      )}

      {market.status === "no-power" && <NoPowerNotice />}

      {market.status === "ok" && (market.pending.length > 0 || market.unavailable > 0) && (
        <div className="flex flex-col gap-1 border-t border-track pt-3 text-xs text-muted">
          {market.unavailable > 0 && (
            <p>
              {plural(
                market.unavailable,
                "offre du marché non proposée",
                "offres du marché non proposées",
              )}{" "}
              en {market.kva} kVA.
            </p>
          )}
          {market.pending.length > 0 && (
            <details>
              <summary className="cursor-pointer hover:text-ink">
                {plural(
                  market.pending.length,
                  "offre du marché pas encore comparable",
                  "offres du marché pas encore comparables",
                )}
              </summary>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {market.pending.map((p) => (
                  <li key={p.name}>
                    <span className="text-ink-soft">{p.name}</span> : {p.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {market.status === "ok" && <div className="border-t border-track pt-3">{note}</div>}
    </section>
  );
}
