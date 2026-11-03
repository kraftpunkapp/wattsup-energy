import { SpotSourceNote } from "@/components/market-source-note";
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

/** Heures de début et de fin d'un segment, lisibles : « 0 h 54 – 6 h 54 ». */
const span = (from: number, to: number) =>
  `${fmtTime(`${Math.floor(from / 60)}:${String(from % 60).padStart(2, "0")}`)} – ${fmtTime(
    `${Math.floor(to / 60) % 24}:${String(to % 60).padStart(2, "0")}`,
  )}`;

/**
 * « Votre journée tarifaire » : une frise de 24 h, heures pleines en bleu, plages creuses en
 * bleu clair, chacune avec son prix. Une plage peut passer minuit (elle est coupée en deux).
 */
function HcBar({ ranges, hp, hc }: { ranges: TimeRange[]; hp: number; hc: number }) {
  const cut = ranges
    .flatMap((r) => {
      const from = minutes(r.from);
      const to = minutes(r.to);
      return to > from
        ? [[from, to] as const]
        : [[from, 1440] as const, ...(to > 0 ? ([[0, to]] as const) : [])];
    })
    .sort((a, b) => a[0] - b[0]);
  // Les heures pleines : tout ce que les plages creuses ne couvrent pas.
  const full: (readonly [number, number])[] = [];
  let at = 0;
  for (const [from, to] of cut) {
    if (from > at) full.push([at, from]);
    at = Math.max(at, to);
  }
  if (at < 1440) full.push([at, 1440]);
  const label = ranges.map((r) => `de ${fmtTime(r.from)} à ${fmtTime(r.to)}`).join(" et ");
  const seg = (from: number, to: number, creuse: boolean) => {
    const width = ((to - from) / 1440) * 100;
    return (
      <div
        key={`${creuse ? "c" : "p"}${from}`}
        className={`absolute inset-y-0 flex flex-col items-center justify-center overflow-hidden text-center leading-tight ${
          creuse ? "bg-hc text-on-hc" : "text-on-grid"
        }`}
        style={{ left: `${(from / 1440) * 100}%`, width: `${width}%` }}
      >
        {width >= 12 ? (
          <>
            <strong className="text-sm">{creuse ? "Heures creuses" : "Heures pleines"}</strong>
            <span className="wu-mono text-xs">{fmtPrice(creuse ? hc : hp)} €/kWh</span>
          </>
        ) : width >= 5 ? (
          <strong className="text-sm">{creuse ? "HC" : "HP"}</strong>
        ) : null}
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold">Votre journée tarifaire</h3>
      <div
        role="img"
        aria-label={`Heures creuses ${label} ; heures pleines le reste de la journée`}
        className="relative h-12 overflow-hidden rounded-control bg-grid"
      >
        {full.map(([from, to]) => seg(from, to, false))}
        {cut.map(([from, to]) => seg(from, to, true))}
      </div>
      <div className="flex justify-between text-[13px] text-muted tabular-nums" aria-hidden>
        <span>0 h</span>
        <span>6 h</span>
        <span>12 h</span>
        <span>18 h</span>
        <span>24 h</span>
      </div>
      <p className="text-sm text-ink-soft text-pretty">
        Creuses : {cut.map(([f, t]) => span(f, t)).join(" et ")}. Ce sont ces horaires qui guident
        vos créneaux dans Prévisions.
      </p>
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
        <div className="flex flex-col gap-4">
          <HcBar ranges={contract.hcRanges} hp={contract.prices.hp} hc={contract.prices.hc} />
          <p className="text-sm text-ink-soft">
            Abonnement :{" "}
            <strong className="text-ink tabular-nums">
              {fmtEur(contract.subscriptionEurYear / 12)} € par mois
            </strong>{" "}
            <span className="text-sm text-muted tabular-nums">
              ({fmtEur(contract.subscriptionEurYear)} €/an)
            </span>
          </p>
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
                sub={
                  [r.onlySobrietyDays ? "jours de sobriété" : null, monthsLabel(r.months)]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
              />
            ))}
            <SubscriptionTile eurYear={contract.subscriptionEurYear} />
          </div>
          {contract.dayStartHour === 6 && (
            <p className="text-[11px] text-subtle">Journée de 6 h à 6 h</p>
          )}
        </div>
      );
    case "spot":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted text-pretty">
            Prix du marché EPEX France heure par heure, plus acheminement, accise et frais du
            fournisseur ({fmtPrice(contract.formula.fees)} €/kWh HT), TVA comprise
            {contract.formula.cap ? ", avec plafond saisonnier" : ""}.
          </p>
          <div className="text-[11px] text-subtle">
            <SpotSourceNote />
          </div>
          <div className={tiles}>
            <SubscriptionTile eurYear={contract.subscriptionEurYear} />
          </div>
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
    case "spot":
      return `prix spot + frais ${fmtPrice(c.formula.fees)} €/kWh HT · ${sub}`;
  }
}
