import { PageHeader } from "@/components/page-header";
import { addDays, localParts } from "@/lib/time";
import {
  currentStock,
  referencePrice,
  toBaseQty,
  type Fuel,
  type ReferencePrice,
} from "@/domain/heating/fuel";
import { visibleModules } from "@/domain/profile";
import { listFuelEvents } from "@/server/fuel";
import { pageContext } from "@/server/page";
import { getHeating, getRefillForecast } from "@/server/queries/heating";
import { ForecastCard } from "./forecast-card";
import { FuelLog } from "./fuel-log";
import { PeriodContent, PeriodTransition } from "@/components/period-transition";
import { HeatingCostCard, HeatingKpis, SeasonSwitcher } from "./heating-cards";
import { heatingSeason } from "@/domain/heating/dju";
import { monthLabel } from "@/domain/overview";
import { FuelCard, type RefillSummary } from "./quick-actions";
import { WoodInvitation } from "./wood-invitation";

export const metadata = { title: "Chauffage · WattsUp Energy" };

const purchaseMonth = (d: Date, timeZone: string) =>
  d.toLocaleDateString("fr-FR", { month: "short", year: "numeric", timeZone });

/** Origine du prix de référence, sous la tuile « Prix moyen payé ». */
function priceNote(price: ReferencePrice | null, timeZone: string): string | null {
  if (!price) return null;
  if (price.basis === "recent") return "achats des 12 derniers mois";
  const month = purchaseMonth(price.purchasedAt, timeZone);
  return price.basis === "last" ? `dernier achat, ${month}` : `premier achat, ${month}`;
}

const THIRTY_DAYS_MS = 30 * 86_400_000;

/** Ce que la prévision dit des granulés, en sacs entiers (hiver moyen, et rigoureux en contrôle). */
function pelletRefill(
  f: NonNullable<Awaited<ReturnType<typeof getRefillForecast>>>["fuels"][number] | undefined,
  bagKg: number,
  perDay: number | null,
  currentEnd: string | null,
): RefillSummary | null {
  const next = f?.next.moyen;
  if (!f || !next || next.status !== "ok") return null;
  const bags = (kg: number) => Math.max(0, Math.ceil(kg / bagKg - 1e-9));
  const cur = f.current?.moyen;
  const rig = f.current?.rigoureux;
  const have = cur && cur.status === "ok";
  return {
    currentEnd: have ? currentEnd : null,
    need: have ? bags(cur.remaining) : null,
    spare: have ? Math.floor((cur.stock - cur.remaining) / bagKg) : null,
    rigorousNeed: rig && rig.status === "ok" ? bags(rig.remaining) : null,
    rigorousOk: rig && rig.status === "ok" ? rig.toBuy <= 0 : null,
    toBuy: have ? bags(cur.toBuy) : null,
    perDay,
    nextLabel: f.nextLabel,
    nextBags: next.order.bags ?? bags(next.toBuy),
    nextCostEur: next.costEur,
  };
}

export default async function HeatingPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string | string[] }>;
}) {
  const ctx = await pageContext("/chauffage");
  const { s } = await searchParams;
  const [view, forecast] = await Promise.all([
    getHeating(ctx, typeof s === "string" ? s : undefined),
    visibleModules(ctx.profile).refillForecast ? getRefillForecast(ctx) : null,
  ]);
  const modules = visibleModules(ctx.profile);
  const fuels: Fuel[] = [
    ...(modules.pellet ? (["pellet"] as const) : []),
    ...(modules.wood ? (["wood"] as const) : []),
  ];
  const events = fuels.length > 0 ? await listFuelEvents(ctx) : [];
  const now = new Date();
  // Dernières saisies d'abord : une consommation passée y apparaît tout de suite.
  const log = events
    .filter((e) => fuels.includes(e.fuel))
    .sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.at.getTime() - a.at.getTime(),
    )
    .slice(0, 20)
    .map((e) => ({
      id: e.id,
      fuel: e.fuel,
      type: e.type,
      at: e.at.toISOString(),
      qty: e.qty,
      unit: e.unit,
      priceEur: e.priceEur,
    }));

  // Rythme mesuré : granulés versés sur les 30 derniers jours (sacs par jour).
  const pelletKg30 = events
    .filter(
      (e) =>
        e.fuel === "pellet" &&
        e.type === "consumption" &&
        now.getTime() - e.at.getTime() <= THIRTY_DAYS_MS &&
        e.at.getTime() <= now.getTime(),
    )
    .reduce((a, e) => a + toBaseQty(e, ctx.settings), 0);
  const perDay = pelletKg30 > 0 ? pelletKg30 / ctx.settings.pelletBagKg / 30 : null;
  const today = localParts(now, ctx.timezone).date;
  const nowSeason = heatingSeason(today, ctx.settings.heatingSeason);
  const seasonEnd =
    today < nowSeason.to ? monthLabel(addDays(nowSeason.to, -1).slice(0, 7)).split(" ")[0] : null;
  const pelletSummary = pelletRefill(
    forecast?.fuels.find((f) => f.fuel === "pellet"),
    ctx.settings.pelletBagKg,
    perDay,
    seasonEnd ? `fin ${seasonEnd}` : null,
  );

  return (
    <>
      <PageHeader
        title="Chauffage"
        subtitle="Granulés, bois et radiateurs, au regard de la météo"
      />
      {fuels.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-start gap-4">
          {fuels.map((fuel) => {
            const price = referencePrice(events, fuel, ctx.settings, now);
            return (
              <FuelCard
                key={fuel}
                summary={{
                  fuel,
                  stock: currentStock(events, fuel, now, ctx.settings),
                  avgPrice: price?.perUnit ?? null,
                  priceNote: priceNote(price, ctx.timezone),
                  bagKg: ctx.settings.pelletBagKg,
                  refill: fuel === "pellet" ? pelletSummary : null,
                }}
              />
            );
          })}
        </div>
      )}
      {!modules.wood && <WoodInvitation />}
      <PeriodTransition>
        <SeasonSwitcher view={view} />
        <PeriodContent>
          <HeatingKpis view={view} />
          <HeatingCostCard view={view} />
        </PeriodContent>
      </PeriodTransition>
      {forecast && <ForecastCard view={forecast} />}
      {fuels.length > 0 && (
        <FuelLog
          items={log}
          timezone={ctx.timezone}
          fuels={fuels}
          currentMonth={localParts(now, ctx.timezone).date.slice(0, 7)}
          settings={{
            pelletBagKg: ctx.settings.pelletBagKg,
            pelletBagsPerPallet: ctx.settings.pelletBagsPerPallet,
          }}
        />
      )}
    </>
  );
}
