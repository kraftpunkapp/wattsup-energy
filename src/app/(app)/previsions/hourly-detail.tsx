"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui";
import { hourLabel } from "@/domain/forecast/summary";
import { formatKwh } from "@/lib/format";
import { localParts } from "@/lib/time";
import type { ForecastHourView } from "./forecast-day";

// « Le détail heure par heure » (maquette V2) : la consommation de chaque heure empilée par
// origine (réseau, soleil, batterie), la production en dessous (soleil direct, soleil mis en
// batterie), le prix d'un kWh de plus avec le meilleur créneau encadré, puis les créneaux des
// appareils. Toucher une heure ouvre son détail à droite. Aujourd'hui, les heures écoulées
// montrent le mesuré (trait noir : ce qui était prévu) et les heures à venir, plus claires, la
// prévision.

export interface DayAppliance {
  id: string;
  name: string;
  icon: IconName;
  /** ISO : début et fin du créneau conseillé. */
  start: string;
  end: string;
}

const AXIS_WIDTH = "w-10";
const kwh = (v: number) => formatKwh(v, v < 10 ? 1 : 0);
const cents = (v: number) =>
  `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} c€`;

const covered = (h: ForecastHourView) => Math.max(0, h.loadKwh - h.importKwh);
const direct = (h: ForecastHourView) => Math.min(h.solarKwh, covered(h));
const fromBattery = (h: ForecastHourView) => covered(h) - direct(h);
/** Solaire produit puis mis en batterie (le reste est revendu). */
const stored = (h: ForecastHourView) => Math.max(0, h.solarKwh - direct(h) - h.exportKwh);

/** Graduations « rondes » sous le maximum : 1 à 3 repères, de la plus grande à la plus petite. */
function ticks(max: number): number[] {
  if (max <= 0) return [];
  const step = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20].find((s) => max / s <= 3) ?? 50;
  const out: number[] = [];
  for (let v = step; v <= max * 1.001; v += step) out.push(Math.round(v * 100) / 100);
  return out.slice(-3);
}

/** Tracé d'une courbe sur l'échelle d'un graphique : une suite par segment de valeurs connues. */
function paths(values: (number | null)[], scale: number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length > 1) out.push(cur.join(" "));
      cur = [];
      return;
    }
    cur.push(`${i + 0.5},${100 - Math.min(v / scale, 1) * 100}`);
  });
  if (cur.length > 1) out.push(cur.join(" "));
  return out;
}

function Lines({
  count,
  scale,
  past,
  future,
}: {
  count: number;
  scale: number;
  past: (number | null)[];
  future: (number | null)[];
}) {
  const solid = paths(past, scale);
  const dashed = paths(future, scale);
  if (solid.length === 0 && dashed.length === 0) return null;
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${count} 100`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {solid.map((p) => (
        <polyline
          key={`s${p}`}
          points={p}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {dashed.map((p) => (
        <polyline
          key={`d${p}`}
          points={p}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/** Colonne de repères à gauche d'un graphique : graduations alignées sur les lignes (le titre est au-dessus). */
function Axis({ height, scale, max }: { height: number; scale: number; max: number }) {
  return (
    <div
      className={`relative flex-none ${AXIS_WIDTH} text-[13px] text-muted`}
      style={{ height }}
      aria-hidden
    >
      {ticks(max).map((t) => (
        <span
          key={t}
          className="absolute right-0 translate-y-1/2 tabular-nums"
          style={{ bottom: `${(t / scale) * height}px` }}
        >
          {t.toLocaleString("fr-FR")}
        </span>
      ))}
    </div>
  );
}

export function HourlyDetail({
  list,
  timezone,
  today,
  date,
  solar,
  battery,
  priced,
  appliances,
  focus,
  onPick,
  description,
  footer,
}: {
  list: ForecastHourView[];
  timezone: string;
  today: string;
  date: string;
  solar: boolean;
  battery: boolean;
  priced: boolean;
  /** Créneaux conseillés tombant ce jour-là. */
  appliances: DayAppliance[];
  focus: ForecastHourView | null;
  onPick: (start: string | null) => void;
  description: ReactNode;
  footer?: ReactNode;
}) {
  const n = list.length;
  const mixed = list.some((h) => h.measured) && list.some((h) => !h.measured);
  const nowIndex = mixed ? list.findIndex((h) => !h.measured) : -1;
  const isLight = (h: ForecastHourView) => mixed && !h.measured;

  const loadMax = Math.max(...list.flatMap((h) => [h.loadKwh, h.estimated?.loadKwh ?? 0]), 0.1);
  const loadScale = loadMax * 1.08;
  const prodMax = Math.max(...list.flatMap((h) => [h.solarKwh, h.estimated?.solarKwh ?? 0]), 0);
  const prodScale = Math.max(prodMax * 1.08, 0.1);
  const showProd = solar && prodMax > 0;

  const costs = list.map((h) => h.kwhCostEur).filter((c): c is number => c !== null);
  const minCost = costs.length ? Math.min(...costs) : null;
  const maxCost = costs.length ? Math.max(...costs) : null;
  const cheap = (h: ForecastHourView) =>
    minCost !== null && h.kwhCostEur !== null && h.kwhCostEur <= minCost * 1.15 + 0.002;
  const showTariff = priced && list.some((h) => !h.measured);

  const indexOf = (iso: string) => {
    const t = new Date(iso).getTime();
    return list.findIndex((h) => new Date(h.start).getTime() + 3_600_000 > t);
  };
  const slots = appliances.flatMap((a) => {
    const from = indexOf(a.start);
    const to = indexOf(a.end);
    if (from < 0) return [];
    const end = to < 0 ? n : to;
    return end > from ? [{ ...a, from, span: end - from }] : [];
  });
  const best = slots[0] ?? null;

  const pastLoad = list.map((h) => h.estimated?.loadKwh ?? null);
  const pastSolar = list.map((h) => h.estimated?.solarKwh ?? null);
  const futureOf = (
    pick: (h: ForecastHourView) => number,
    est: (h: ForecastHourView) => number | null,
  ) =>
    list.map((h, i) =>
      !h.measured ? pick(h) : list[i + 1] && !list[i + 1]?.measured ? est(h) : null,
    );
  // Les courbes ne servent qu'à comparer le mesuré à ce qui était prévu (jour en cours).
  const futureLoad = !mixed
    ? []
    : futureOf(
        (h) => h.loadKwh,
        (h) => h.estimated?.loadKwh ?? null,
      );
  const futureSolar = !mixed
    ? []
    : futureOf(
        (h) => h.solarKwh,
        (h) => h.estimated?.solarKwh ?? null,
      );

  const hourName = (h: ForecastHourView) => {
    const start = new Date(h.start);
    return `${hourLabel(start, timezone)} – ${hourLabel(new Date(start.getTime() + 3_600_000), timezone)}`;
  };
  const aria = (h: ForecastHourView) =>
    `${hourName(h)}, ${h.measured ? "mesuré" : "prévu"} : ${kwh(h.loadKwh)} consommés${
      solar ? `, ${kwh(h.solarKwh)} produits` : ""
    }`;
  const focusIndex = focus ? list.findIndex((h) => h.start === focus.start) : -1;
  const step = (d: number) => {
    const next = list[Math.min(n - 1, Math.max(0, (focusIndex < 0 ? 0 : focusIndex) + d))];
    if (next) onPick(next.start);
  };

  const columnBg = (h: ForecastHourView) =>
    h.start === focus?.start ? "bg-track" : "bg-transparent";
  const LOAD_H = 200;
  const PROD_H = 104;

  const swatch = (cls: string, round = "rounded-[3px]") => (
    <span className={`size-2.5 flex-none ${round} ${cls}`} />
  );

  return (
    <section
      aria-labelledby="heure-titre"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6 sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h2 id="heure-titre" className="text-[15px] font-bold">
            Le détail heure par heure
          </h2>
          <p className="text-sm text-muted">{description}</p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-ink-soft">
          <li className="flex items-center gap-1.5">{swatch("bg-grid")}Réseau</li>
          {showProd && <li className="flex items-center gap-1.5">{swatch("bg-solar")}Solaire</li>}
          {battery && <li className="flex items-center gap-1.5">{swatch("bg-battery")}Batterie</li>}
          {showProd && battery && (
            <li className="flex items-center gap-1.5">
              {swatch("wu-hatch-solar border border-solar")}Solaire mis en batterie
            </li>
          )}
          {mixed && (
            <>
              <li className="flex items-center gap-1.5">
                <span className="h-0 w-3.5 border-t-2 border-ink" />
                Ce qui était prévu
              </li>
              <li className="flex items-center gap-1.5">
                {swatch("bg-grid/30 border border-dashed border-grid")}Encore à venir
              </li>
            </>
          )}
        </ul>
      </div>

      <div className="flex flex-wrap gap-7">
        <div className="flex min-w-0 flex-[3_1_560px] flex-col gap-1.5">
          <p className="wu-label">
            Consommé · <span className="normal-case">kWh</span>
          </p>
          <div className="flex gap-2">
            <Axis height={LOAD_H} scale={loadScale} max={loadMax} />
            <div
              className="relative min-w-0 flex-1 border-b border-border-strong"
              style={{ height: LOAD_H }}
            >
              {ticks(loadMax).map((t) => (
                <div
                  key={t}
                  className="absolute inset-x-0 border-t border-track"
                  style={{ bottom: `${(t / loadScale) * 100}%` }}
                />
              ))}
              {nowIndex >= 0 && (
                <div
                  className="absolute inset-y-0 right-0 bg-bg/60"
                  style={{ left: `${(nowIndex / n) * 100}%` }}
                />
              )}
              <div className="absolute inset-0 flex items-end gap-[3px]">
                {list.map((h) => {
                  const light = isLight(h);
                  return (
                    <button
                      key={h.start}
                      type="button"
                      aria-label={aria(h)}
                      aria-pressed={h.start === focus?.start}
                      title={aria(h)}
                      onClick={() => onPick(h.start === focus?.start ? null : h.start)}
                      className={`flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end rounded-t-[4px] p-0 ${columnBg(h)}`}
                    >
                      {battery && (
                        <span
                          className={light ? "bg-battery/35" : "bg-battery"}
                          style={{ height: `${(fromBattery(h) / loadScale) * 100}%` }}
                        />
                      )}
                      {solar && (
                        <span
                          className={light ? "bg-solar/45" : "bg-solar"}
                          style={{ height: `${(direct(h) / loadScale) * 100}%` }}
                        />
                      )}
                      <span
                        className={
                          light
                            ? "box-border border border-dashed border-grid bg-grid/30"
                            : "bg-grid"
                        }
                        style={{ height: `${(h.importKwh / loadScale) * 100}%` }}
                      />
                    </button>
                  );
                })}
              </div>
              <Lines count={n} scale={loadScale} past={pastLoad} future={futureLoad} />
              {nowIndex > 0 && (
                <>
                  <div
                    className="absolute -top-2 -bottom-1.5 w-0.5 bg-ink"
                    style={{ left: `${(nowIndex / n) * 100}%` }}
                  />
                  <span
                    className="absolute -top-3.5 -translate-x-1/2 rounded-full bg-ink px-2 py-0.5 text-[13px] font-bold whitespace-nowrap text-on-accent"
                    style={{ left: `${(nowIndex / n) * 100}%` }}
                  >
                    {localParts(new Date(list[nowIndex].start), timezone).hour} h · maintenant
                  </span>
                </>
              )}
            </div>
          </div>

          {showProd && (
            <>
              <p className="wu-label mt-5">
                Produit · <span className="normal-case">kWh</span>
              </p>
              <div className="flex gap-2">
                <Axis height={PROD_H} scale={prodScale} max={prodMax} />
                <div
                  className="relative min-w-0 flex-1 border-b border-border-strong"
                  style={{ height: PROD_H }}
                >
                  {ticks(prodMax).map((t) => (
                    <div
                      key={t}
                      className="absolute inset-x-0 border-t border-track"
                      style={{ bottom: `${(t / prodScale) * 100}%` }}
                    />
                  ))}
                  {nowIndex >= 0 && (
                    <div
                      className="absolute inset-y-0 right-0 bg-bg/60"
                      style={{ left: `${(nowIndex / n) * 100}%` }}
                    />
                  )}
                  <div className="absolute inset-0 flex items-end gap-[3px]">
                    {list.map((h) => {
                      const light = isLight(h);
                      return (
                        <div
                          key={h.start}
                          className={`flex h-full min-w-0 flex-1 flex-col justify-end rounded-t-[4px] ${columnBg(h)}`}
                        >
                          {battery && (
                            <span
                              className={`wu-hatch-solar rounded-t-[3px] ${light ? "opacity-55" : ""}`}
                              style={{ height: `${(stored(h) / prodScale) * 100}%` }}
                            />
                          )}
                          <span
                            className={light ? "bg-solar/45" : "bg-solar"}
                            style={{
                              height: `${(Math.max(0, h.solarKwh - (battery ? stored(h) : 0)) / prodScale) * 100}%`,
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <Lines count={n} scale={prodScale} past={pastSolar} future={futureSolar} />
                  {nowIndex > 0 && (
                    <div
                      className="absolute -bottom-1.5 top-0 w-0.5 bg-ink"
                      style={{ left: `${(nowIndex / n) * 100}%` }}
                    />
                  )}
                </div>
              </div>
            </>
          )}

          {showTariff && (
            <div className="mt-8 flex gap-2">
              <span
                className={`flex-none ${AXIS_WIDTH} self-center text-[13px] leading-tight font-semibold text-ink-soft`}
              >
                Si vous lancez un appareil
              </span>
              <div className="relative flex min-w-0 flex-1 gap-[3px]">
                {list.map((h) => (
                  <span
                    key={h.start}
                    aria-hidden
                    className={`h-7 min-w-0 flex-1 rounded ${
                      h.measured ? "bg-track" : cheap(h) ? "bg-hc" : "bg-grid"
                    }`}
                  />
                ))}
                {best && (
                  <>
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -top-[5px] -bottom-[5px] rounded-lg border-[2.5px] border-ink"
                      style={{
                        left: `calc(${(best.from / n) * 100}% - 3px)`,
                        width: `calc(${(best.span / n) * 100}% + 2px)`,
                      }}
                    />
                    <span
                      className="absolute -top-[26px] text-[13px] font-bold whitespace-nowrap"
                      style={{ left: `${(best.from / n) * 100}%` }}
                    >
                      Meilleur créneau
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2" aria-hidden>
            <span className={`flex-none ${AXIS_WIDTH}`} />
            <div className="flex flex-1 gap-[3px] text-[13px] text-muted">
              {list.map((h, i) => (
                <span key={h.start} className="min-w-0 flex-1 text-center">
                  {i % 3 === 0 ? `${localParts(new Date(h.start), timezone).hour} h` : ""}
                </span>
              ))}
            </div>
          </div>

          {showTariff && minCost !== null && maxCost !== null && (
            <div className="flex gap-2">
              <span className={`flex-none ${AXIS_WIDTH}`} />
              <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-soft">
                <span className="text-muted">Chaque kWh qu&apos;il consommera vous coûtera :</span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-3.5 rounded-[3px] bg-hc" />
                  {cents(minCost)} · le moins cher
                </span>
                {maxCost > minCost * 1.15 + 0.002 && (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-3.5 rounded-[3px] bg-grid" />
                    jusqu&apos;à {cents(maxCost)}
                    {battery ? " · heures pleines, ou soleil qui aurait rempli la batterie" : ""}
                  </span>
                )}
              </div>
            </div>
          )}

          {slots.length > 0 && (
            <div
              className="mt-4 flex flex-col gap-1.5 border-t border-track pt-3.5"
              role="img"
              aria-label={`Créneaux conseillés : ${slots
                .map(
                  (s) =>
                    `${s.name} de ${hourLabel(new Date(s.start), timezone)} à ${hourLabel(new Date(s.end), timezone)}`,
                )
                .join(", ")}`}
            >
              <div className="flex items-baseline gap-2">
                <span className={`flex-none ${AXIS_WIDTH} text-[13px] font-bold`}>
                  Vos appareils
                </span>
                <span className="text-[13px] text-muted">
                  Créneaux conseillés {date === today ? "pour aujourd'hui" : "pour demain"}
                </span>
              </div>
              {slots.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className={`flex-none ${AXIS_WIDTH} truncate text-[13px] text-ink-soft`}>
                    {s.name}
                  </span>
                  <div
                    className="relative h-8 min-w-0 flex-1"
                    style={{
                      backgroundImage: `repeating-linear-gradient(90deg, transparent 0 calc(100% / ${n} - 1px), var(--color-track) calc(100% / ${n} - 1px) calc(100% / ${n}))`,
                    }}
                  >
                    {(() => {
                      const label = `${hourLabel(new Date(s.start), timezone)} – ${hourLabel(new Date(s.end), timezone)}`;
                      // Créneau étroit : l'heure s'écrit à côté de la barre, du côté où il y a de la place.
                      const narrow = s.span < 4;
                      const atEnd = s.from + s.span > n - 5;
                      return (
                        <>
                          <span
                            className="absolute inset-y-0.5 flex items-center gap-1.5 overflow-hidden rounded-lg bg-accent px-2 text-[13px] font-bold whitespace-nowrap text-on-accent"
                            style={{
                              left: `${(s.from / n) * 100}%`,
                              width: `${(s.span / n) * 100}%`,
                            }}
                          >
                            <Icon name={s.icon} size={15} />
                            {!narrow && label}
                          </span>
                          {narrow && (
                            <span
                              className="absolute top-1/2 -translate-y-1/2 text-[13px] font-bold whitespace-nowrap"
                              style={
                                atEnd
                                  ? { right: `${((n - s.from) / n) * 100 + 1}%` }
                                  : { left: `${((s.from + s.span) / n) * 100 + 1}%` }
                              }
                            >
                              {label}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
          {footer}
        </div>

        <aside aria-live="polite" className="flex min-w-0 flex-[1_1_250px] flex-col gap-3.5">
          {focus ? (
            <div className="flex flex-col gap-4 rounded-[14px] bg-bg p-[18px]">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[15px] font-bold">{hourName(focus)}</h3>
                <span className="rounded-full bg-track px-2.5 py-1 text-[13px] font-bold">
                  {focus.measured ? "Mesuré" : "Prévu"}
                </span>
              </div>
              <Figure
                icon="home"
                tone="bg-grid/12 text-grid"
                label="Consommé"
                big={kwh(focus.loadKwh)}
                estimate={focus.estimated?.loadKwh}
                actual={focus.loadKwh}
              />
              <p className="-mt-2 flex flex-col gap-0.5 border-l-2 border-border pl-2.5 text-sm text-ink-soft tabular-nums">
                <span>réseau {kwh(focus.importKwh)}</span>
                {solar && <span>soleil {kwh(direct(focus))}</span>}
                {battery && <span>batterie {kwh(fromBattery(focus))}</span>}
              </p>
              {solar && (
                <Figure
                  icon="sun"
                  tone="bg-solar/15 text-solar-ink"
                  label="Produit"
                  big={kwh(focus.solarKwh)}
                  estimate={focus.estimated?.solarKwh}
                  actual={focus.solarKwh}
                  more
                />
              )}
              {!focus.measured && focus.kwhCostEur !== null && (
                <>
                  <p className="flex justify-between gap-3 border-t border-border pt-3 text-sm">
                    <span className="text-ink-soft">Lancer un appareil à cette heure</span>
                    <strong className="whitespace-nowrap tabular-nums">
                      {cents(focus.kwhCostEur)} / kWh
                    </strong>
                  </p>
                  <p className="-mt-2 text-[13px] text-ink-soft text-pretty">
                    {(focus.offPeakShare ?? 0) >= 0.5
                      ? "Heure creuse : le moment idéal pour ce qui peut attendre."
                      : battery && stored(focus) > 0
                        ? "Le soleil remplit la batterie : un kWh pris maintenant serait racheté le soir en heure pleine."
                        : "Heure pleine."}
                  </p>
                </>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="Heure précédente"
                  onClick={() => step(-1)}
                  className="flex size-11 cursor-pointer items-center justify-center rounded-control border border-border-strong bg-surface"
                >
                  <span className="rotate-180">
                    <Icon name="chevron" size={18} />
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Heure suivante"
                  onClick={() => step(1)}
                  className="flex size-11 cursor-pointer items-center justify-center rounded-control border border-border-strong bg-surface"
                >
                  <Icon name="chevron" size={18} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-[14px] border border-dashed border-dash p-[18px] text-ink-soft">
              <span className="text-sm font-semibold text-ink">Une heure en particulier ?</span>
              <span className="text-sm">Touchez une barre pour son détail.</span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

/** Un chiffre du panneau d'heure, avec l'écart au prévu quand l'heure est écoulée. */
function Figure({
  icon,
  tone,
  label,
  big,
  estimate,
  actual,
  more = false,
}: {
  icon: IconName;
  tone: string;
  label: string;
  big: string;
  estimate: number | undefined;
  actual: number;
  /** Plus que prévu est une bonne nouvelle (production). */
  more?: boolean;
}) {
  const gap = estimate !== undefined ? actual - estimate : null;
  const flat = gap === null || Math.abs(gap) < 0.05;
  const good = gap !== null && (more ? gap > 0 : gap < 0);
  return (
    <div className="flex items-start gap-3.5">
      <span
        aria-hidden
        className={`flex size-10 flex-none items-center justify-center rounded-xl ${tone}`}
      >
        <Icon name={icon} size={20} />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-sm text-ink-soft">{label}</span>
        <span className="text-xl leading-none font-bold tabular-nums">{big}</span>
        {estimate !== undefined && (
          <span
            className={`text-sm font-semibold tabular-nums ${
              flat ? "text-ink-soft" : good ? "text-positive" : "text-ink"
            }`}
          >
            {flat
              ? `comme prévu (${kwh(estimate)})`
              : `${gap > 0 ? "+" : "−"}${kwh(Math.abs(gap))} par rapport aux ${kwh(estimate)} prévus`}
          </span>
        )}
      </div>
    </div>
  );
}
