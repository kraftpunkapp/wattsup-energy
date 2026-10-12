import { StatTile, tiles } from "@/components/ui";
import { monthsLabel } from "@/domain/tariff/seasons";
import type { Contract, TempoColor, TimeRange } from "@/domain/tariff/types";

// Lecture d'une grille de prix : chiffres en Instrument Sans tabulaire (lisibles en petit
// corps), libellé au-dessus, unité à côté.

export const fmtPrice = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const fmtEur = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTime = (t: string) => {
  const [h = "0", m = "00"] = t.split(":");
  return m === "00" ? `${Number(h)} h` : `${Number(h)} h ${m}`;
};

const TEMPO_ROWS: { color: TempoColor; label: string; dot: string }[] = [
  { color: "bleu", label: "Bleu", dot: "bg-grid" },
  { color: "blanc", label: "Blanc", dot: "bg-dash" },
  { color: "rouge", label: "Rouge", dot: "bg-eheat" },
];

function SubscriptionTile({ eurYear }: { eurYear: number }) {
  return (
    <StatTile
      label="Abonnement"
      value={fmtEur(eurYear / 12)}
      unit="€/mois"
      sub={`${fmtEur(eurYear)} €/an`}
    />
  );
}

const minutes = (t: string) => {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Frise de 24 h : plages d'heures creuses (une plage peut passer minuit). */
function HcBar({ ranges }: { ranges: TimeRange[] }) {
  const segments = ranges.flatMap((r) => {
    const from = minutes(r.from);
    const to = minutes(r.to);
    return to > from
      ? [[from, to]]
      : [
          [from, 1440],
          [0, to],
        ];
  });
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="text-muted">Plages creuses</span>
        <span className="font-medium tabular-nums">
          {ranges.map((r) => `${fmtTime(r.from)} – ${fmtTime(r.to)}`).join(" · ")}
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-track" aria-hidden>
        {segments.map(([from = 0, to = 0], i) => (
          <span
            key={i}
            className="absolute inset-y-0 bg-grid"
            style={{ left: `${(from / 1440) * 100}%`, width: `${((to - from) / 1440) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-subtle tabular-nums" aria-hidden>
        <span>0 h</span>
        <span>6 h</span>
        <span>12 h</span>
        <span>18 h</span>
        <span>24 h</span>
      </div>
    </div>
  );
}

/** Prix d'une grille, mis en forme selon le type de contrat. */
export function GridView({ contract }: { contract: Contract }) {
  switch (contract.kind) {
    case "base":
      return (
        <div className={tiles}>
          <StatTile label="Prix du kWh" value={fmtPrice(contract.priceEurKwh)} unit="€/kWh" />
          <SubscriptionTile eurYear={contract.subscriptionEurYear} />
        </div>
      );
    case "hphc":
      return (
        <div className="flex flex-col gap-3">
          <div className={tiles}>
            <StatTile label="Heures pleines" value={fmtPrice(contract.prices.hp)} unit="€/kWh" />
            <StatTile
              label="Heures creuses"
              value={fmtPrice(contract.prices.hc)}
              unit="€/kWh"
              dot="bg-grid"
            />
            <SubscriptionTile eurYear={contract.subscriptionEurYear} />
          </div>
          <HcBar ranges={contract.hcRanges} />
        </div>
      );
    case "tempo":
      return (
        <div className="flex flex-col gap-2">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="text-[11px] text-muted">
              <tr>
                <th className="py-1 font-normal">Jour</th>
                <th className="py-1 text-right font-normal">Heures pleines</th>
                <th className="py-1 text-right font-normal">Heures creuses</th>
              </tr>
            </thead>
            <tbody>
              {TEMPO_ROWS.map((row) => (
                <tr key={row.color} className="border-t border-track">
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className={`size-2 rounded-full ${row.dot}`} />
                      {row.label}
                    </span>
                  </td>
                  <td className="py-1.5 text-right text-sm font-semibold">
                    {fmtPrice(contract.prices[row.color].hp)}
                  </td>
                  <td className="py-1.5 text-right text-sm font-semibold">
                    {fmtPrice(contract.prices[row.color].hc)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-subtle">
            Prix en €/kWh · heures creuses de 22 h à 6 h · jour Tempo de 6 h à 6 h
          </p>
          <div className="grid grid-cols-2 gap-2">
            <SubscriptionTile eurYear={contract.subscriptionEurYear} />
          </div>
        </div>
      );
    case "custom":
      return (
        <div className="flex flex-col gap-2">
          <div className={tiles}>
            {contract.rules.map((r) => (
              <StatTile
                key={r.label}
                label={r.label}
                value={fmtPrice(r.price)}
                unit="€/kWh"
                sub={monthsLabel(r.months) ?? undefined}
              />
            ))}
            <SubscriptionTile eurYear={contract.subscriptionEurYear} />
          </div>
          {contract.dayStartHour === 6 && (
            <p className="text-[11px] text-subtle">Journée de 6 h à 6 h</p>
          )}
        </div>
      );
  }
}

/** Résumé d'une ligne (historique des prix). */
export function gridSummary(c: Contract): string {
  const sub = `abonnement ${fmtEur(c.subscriptionEurYear / 12)} €/mois`;
  switch (c.kind) {
    case "base":
      return `${fmtPrice(c.priceEurKwh)} €/kWh · ${sub}`;
    case "hphc":
      return `HP ${fmtPrice(c.prices.hp)} · HC ${fmtPrice(c.prices.hc)} €/kWh · ${sub}`;
    case "tempo":
      return `Bleu HP ${fmtPrice(c.prices.bleu.hp)} · Rouge HP ${fmtPrice(c.prices.rouge.hp)} €/kWh · ${sub}`;
    case "custom":
      return `${c.rules.map((r) => `${r.label} ${fmtPrice(r.price)}`).join(" · ")} · ${sub}`;
  }
}
