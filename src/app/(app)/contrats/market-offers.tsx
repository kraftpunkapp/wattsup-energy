"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Badge, button, Icon, Notice } from "@/components/ui";
import { METER_POWERS } from "@/domain/market/compare";
import { addMarketOfferAction, saveMeterPowerAction } from "@/server/actions/market";

// Offres du marché (T55, SPEC §7.12) : même présentation que « Coût annuel simulé » (ligne,
// coût annuel, écart avec le contrat actuel, barre), avec la grille officielle et l'ajout à
// ses offres. Puissance du compteur réglable dans l'en-tête de la carte.

export interface MarketOfferView {
  name: string;
  provider: string;
  offer: string;
  kind: string;
  regulated: boolean;
  gridDate: string;
  oldGrid: boolean;
  annualCents: number;
  deltaAnnualCents: number | null;
  assumedOffPeak: boolean;
  approximate: boolean;
  assumedTempoDays: number;
  priceUrl: string | null;
  /** Déjà dans les offres du foyer (même nom). */
  added: boolean;
}

const TOP = 5;
const COMMON_POWERS = [6, 9, 12] as const;
const eur = (cents: number) => `${Math.round(cents / 100).toLocaleString("fr-FR")} €`;
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function Shell({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">Offres du marché</h2>
        {header}
      </div>
      {children}
    </section>
  );
}

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

/** Sans puissance du compteur : encart avec les puissances courantes en un clic. */
export function MarketOffersNoPower() {
  const power = usePower();
  return (
    <Shell header={null}>
      <Notice
        tone="info"
        title="Puissance du compteur :"
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
        indiquez-la (en kVA, sur votre facture ou votre contrat) pour comparer les offres des
        fournisseurs sur votre consommation réelle.
      </Notice>
      {power.error && (
        <p role="alert" className="text-xs text-negative">
          {power.error}
        </p>
      )}
    </Shell>
  );
}

function AddButton({ name }: { name: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await addMarketOfferAction(name);
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

function OfferLine({ o, best, max }: { o: MarketOfferView; best: boolean; max: number }) {
  const delta = o.deltaAnnualCents;
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{o.offer}</span>
          <span className="text-xs text-muted">{o.provider}</span>
          <Badge>{o.kind}</Badge>
          {o.regulated && <Badge tone="soft">Tarif réglementé</Badge>}
        </span>
        <span className="flex flex-none flex-col items-end">
          <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">
            {eur(o.annualCents)}/an
          </span>
          {delta !== null && (
            <span
              className={`text-[11px] font-medium tabular-nums ${
                delta === 0 ? "text-subtle" : delta < 0 ? "text-positive" : "text-negative"
              }`}
            >
              {delta === 0 ? "= votre contrat" : `${delta < 0 ? "−" : "+"}${eur(Math.abs(delta))}`}
            </span>
          )}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-track">
        <div
          className={`h-1.5 rounded-full ${best ? "bg-battery" : "bg-dash"}`}
          style={{ width: `${(o.annualCents / max) * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
        <span className="flex items-center gap-1.5 tabular-nums">
          grille du {o.gridDate}
          {o.oldGrid && <Badge tone="warning">Ancienne</Badge>}
        </span>
        {o.priceUrl && (
          <a
            href={o.priceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${button.link} inline-flex items-center gap-1`}
          >
            Grille officielle
            <Icon name="external" size={12} />
          </a>
        )}
        {o.added ? (
          <span className="inline-flex items-center gap-1 text-positive">
            <Icon name="check" size={12} />
            Dans vos offres
          </span>
        ) : (
          <AddButton name={o.name} />
        )}
      </div>
      {(o.assumedOffPeak || o.approximate || o.assumedTempoDays > 0) && (
        <span className="text-[11px] text-pellet text-pretty">
          {o.assumedOffPeak &&
            "Heures creuses supposées de 22 h à 6 h (celles de votre compteur sont inconnues). "}
          {o.approximate &&
            "Simulation approximative : passez en envoi horaire pour plus de précision. "}
          {o.assumedTempoDays > 0 &&
            `${plural(o.assumedTempoDays, "jour", "jours")} de couleur inconnue, supposé${o.assumedTempoDays > 1 ? "s" : ""} bleu${o.assumedTempoDays > 1 ? "s" : ""}.`}
        </span>
      )}
    </li>
  );
}

export function MarketOffersList({
  kva,
  offers,
  pending,
  unavailable,
  hasCurrent,
  note,
}: {
  kva: number;
  offers: MarketOfferView[];
  pending: { name: string; reason: string }[];
  unavailable: number;
  hasCurrent: boolean;
  /** Mentions (avertissement et source), rendues par le serveur. */
  note: ReactNode;
}) {
  const power = usePower();
  const [all, setAll] = useState(false);
  const shown = all ? offers : offers.slice(0, TOP);
  const max = Math.max(...offers.map((o) => o.annualCents), 1);

  return (
    <Shell header={<PowerSelect value={kva} onChange={power.save} disabled={power.pending} />}>
      <p className="text-xs text-muted text-pretty">
        {plural(offers.length, "offre comparée", "offres comparées")} sur votre consommation des
        mêmes mois
        {hasCurrent ? " · écart avec votre contrat actuel" : ""}
      </p>
      {power.error && (
        <p role="alert" className="text-xs text-negative">
          {power.error}
        </p>
      )}
      {offers.length === 0 ? (
        <p className="text-[13px] text-muted">
          Aucune offre du catalogue n&apos;est proposée en {kva} kVA.
        </p>
      ) : (
        <ul className={`flex flex-col gap-3 ${power.pending ? "opacity-50" : ""}`}>
          {shown.map((o, i) => (
            <OfferLine key={o.name} o={o} best={i === 0} max={max} />
          ))}
        </ul>
      )}
      {offers.length > TOP && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          aria-expanded={all}
          className={`${button.secondary} self-start`}
        >
          {all ? "Voir les 5 moins chères" : `Voir les ${offers.length} offres`}
        </button>
      )}
      {(pending.length > 0 || unavailable > 0) && (
        <div className="flex flex-col gap-1 border-t border-track pt-3 text-xs text-muted">
          {unavailable > 0 && (
            <p>
              {plural(unavailable, "offre non proposée", "offres non proposées")} en {kva} kVA.
            </p>
          )}
          {pending.length > 0 && (
            <details>
              <summary className="cursor-pointer hover:text-ink">
                {plural(
                  pending.length,
                  "offre pas encore comparable",
                  "offres pas encore comparables",
                )}
              </summary>
              <ul className="mt-1.5 flex flex-col gap-0.5">
                {pending.map((p) => (
                  <li key={p.name}>
                    <span className="text-ink-soft">{p.name}</span> : {p.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <div className="border-t border-track pt-3">{note}</div>
    </Shell>
  );
}
