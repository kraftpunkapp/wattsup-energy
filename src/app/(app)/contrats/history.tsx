import { formatPercent } from "@/lib/format";
import type { ContractItem } from "./contracts-manager";
import { fmtPrice, gridSummary } from "./grid-view";
import { KIND_LABELS } from "./labels";

// « Vos contrats depuis 2023 » : les contrats souscrits dans l'ordre, avec leurs prix de départ
// et l'évolution d'un contrat au suivant. Une carte par contrat, l'en cours en tête de lecture.

const eur2 = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Prices = { hp: number; hc: number | null };

/** Prix du kWh en heures pleines (et creuses) d'une grille ; null pour un contrat sans HP/HC lisible. */
function prices(c: ContractItem["periods"][number]["contract"]): Prices | null {
  if (c.kind === "base") return { hp: c.priceEurKwh, hc: null };
  if (c.kind === "hphc") return { hp: c.prices.hp, hc: c.prices.hc };
  if (c.kind === "tempo") return { hp: c.prices.bleu.hp, hc: c.prices.bleu.hc };
  return null;
}

const yearOf = (iso: string) => iso.slice(0, 4);
const monthShort = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "short", year: "numeric" });

const variation = (now: number, before: number | undefined) => {
  if (!before || before <= 0) return null;
  const v = now / before - 1;
  if (Math.abs(v) < 0.005) return "stable";
  return `${v > 0 ? "+" : "−"}${formatPercent(Math.abs(v))}`;
};

export function ContractHistory({ contracts }: { contracts: ContractItem[] }) {
  const list = contracts
    .filter((c) => c.status === "subscribed" && c.startDate)
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
  if (list.length < 2) return null;
  const rows = list.map((c) => {
    const grid = c.periods.filter((p) => p.validFrom <= (c.startDate ?? "")).at(-1) ?? c.periods[0];
    return { c, contract: grid?.contract };
  });
  const first = rows.find((r) => r.contract && prices(r.contract));
  const last = [...rows].reverse().find((r) => r.contract && prices(r.contract));
  const firstHp = first?.contract && prices(first.contract)?.hp;
  const lastHp = last?.contract && prices(last.contract)?.hp;
  const overall =
    first && last && first !== last && firstHp && lastHp ? variation(lastHp, firstHp) : null;
  const since = list[0]?.startDate ? yearOf(list[0].startDate) : "";

  return (
    <section
      aria-labelledby="hist-titre"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6 sm:p-7"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="hist-titre" className="text-xl font-bold">
          Vos contrats depuis {since}
        </h2>
        {overall && (
          <span className="text-sm text-ink-soft">
            Prix du kWh en heures pleines : <strong className="text-ink">{overall}</strong> depuis{" "}
            {since}
          </span>
        )}
      </div>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-y-4">
        {rows.map(({ c, contract }, i) => {
          const p = contract ? prices(contract) : null;
          const before = i > 0 ? rows[i - 1]?.contract : undefined;
          const pb = before ? prices(before) : null;
          const hpVar = p ? variation(p.hp, pb?.hp) : null;
          const hcVar = p && p.hc !== null ? variation(p.hc, pb?.hc ?? undefined) : null;
          const end = c.endDate && !c.isCurrent ? ` → ${monthShort(c.endDate)}` : "";
          return (
            <li
              key={c.id}
              className={`flex flex-col gap-1.5 border-t-[3px] py-3.5 pr-4 ${
                c.isCurrent ? "border-ink" : "border-dash"
              }`}
            >
              <span className="text-[13px] text-muted">
                {c.isCurrent && "Depuis "}
                {c.startDate && (c.isCurrent ? monthShort(c.startDate) : yearOf(c.startDate))}
                {end}
                {c.isCurrent && " · en cours"}
              </span>
              <strong className="text-base">{c.name}</strong>
              <span className="text-xs text-muted">{KIND_LABELS[c.kind]}</span>
              {contract && p ? (
                <span className="text-sm text-ink-soft tabular-nums">
                  HP {fmtPrice(p.hp)}
                  {p.hc !== null && <> · HC {fmtPrice(p.hc)}</>}
                  <br />
                  abonnement {eur2(contract.subscriptionEurYear / 12)} €/mois
                </span>
              ) : (
                contract && <span className="text-sm text-ink-soft">{gridSummary(contract)}</span>
              )}
              {(hpVar || hcVar) && (
                <span className="text-[13px] font-semibold tabular-nums">
                  {hpVar && <>HP {hpVar}</>}
                  {hpVar && hcVar && ", "}
                  {hcVar && <>HC {hcVar}</>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
