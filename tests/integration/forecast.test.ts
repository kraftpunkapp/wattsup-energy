import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { energyInterval, weatherForecastHourly } from "@/db/schema";
import { cellOf } from "@/domain/weather";
import { householdContextFor, type HouseholdContext } from "@/server/context";
import { saveEquipment } from "@/server/equipment";
import { getSolarForecast } from "@/server/forecast";
import { setLocation } from "@/server/location";
import { updateProfile } from "@/server/profile";
import { createTestHousehold } from "../helpers/tenancy";

// Prévisions « Demain » (T68, SPEC §7.14) : production solaire prévue d'après le rendement
// appris sur l'historique du foyer et la météo horaire de sa commune.

const now = new Date("2026-11-21T12:00:00Z");
let n = 0;

type Location = { label: string; lat: number; lon: number };

async function solarHousehold(
  at?: Location,
): Promise<{ ctx: HouseholdContext; cell: ReturnType<typeof cellOf>; location: Location }> {
  n += 1;
  const base = await createTestHousehold("prevision-solaire");
  await updateProfile(base, { ...base.profile, solar: true });
  const location = at ?? { label: `Soleil ${n}`, lat: 35 + n / 100, lon: 45 + n / 100 };
  await setLocation(base, location);
  return { ctx: await householdContextFor(base.userId), cell: cellOf(location), location };
}

/** 20 jours de production (1 kWh de 8 h à 16 h UTC) pour un foyer. */
async function production(ctx: HouseholdContext) {
  const rows = [];
  for (let d = -20; d < 0; d++) {
    for (let h = 8; h < 16; h++) {
      rows.push({
        householdId: ctx.householdId,
        metric: "solar_production",
        start: new Date(Date.UTC(2026, 10, 21 + d, h)),
        granularity: "hour" as const,
        kwh: 1, // 0,5 kWh/m² reçus → 2 kWh par kWh/m²
        source: "ha" as const,
      });
    }
  }
  await db.insert(energyInterval).values(rows);
}

/** 20 jours passés (8 h – 15 h UTC, 500 W/m²) et demain (400 W/m²) pour la maille. */
async function weather(cell: ReturnType<typeof cellOf>) {
  const rows = [];
  for (let d = -20; d <= 1; d++) {
    for (let h = 8; h < 16; h++) {
      rows.push({
        ...cell,
        start: new Date(Date.UTC(2026, 10, 21 + d, h)),
        radiationWm2: d === 1 ? 400 : 500,
        temperatureC: 7,
      });
    }
  }
  await db.insert(weatherForecastHourly).values(rows);
}

describe("production solaire prévue", () => {
  it("rendement appris (2 kWh par kWh/m²) appliqué au rayonnement de demain", async () => {
    const { ctx, cell } = await solarHousehold();
    await weather(cell);
    await production(ctx);

    const f = await getSolarForecast(ctx, now);
    expect(f?.method).toBe("learned");
    const tomorrow10 = f?.hours.find((h) => h.start.getTime() === Date.UTC(2026, 10, 22, 10));
    expect(tomorrow10?.kwh).toBeCloseTo(0.8, 6);
    // Aujourd'hui et demain seulement : rien avant minuit local aujourd'hui.
    expect(f?.hours.every((h) => h.start.getTime() >= Date.UTC(2026, 10, 20, 23))).toBe(true);
  });

  it("voisin de la même commune : sa production ne sert pas ; puissance seule → estimation", async () => {
    const neighbour = await solarHousehold();
    await weather(neighbour.cell);
    await production(neighbour.ctx);
    const { ctx } = await solarHousehold(neighbour.location);
    expect(await getSolarForecast(ctx, now)).toBeNull();
    await saveEquipment(ctx, "solar", {
      label: "Panneaux",
      capacity: 3,
      installedOn: "2025-04-01",
      costEur: 6000,
    });
    const f = await getSolarForecast(ctx, now);
    expect(f?.method).toBe("kwc");
    const tomorrow10 = f?.hours.find((h) => h.start.getTime() === Date.UTC(2026, 10, 22, 10));
    expect(tomorrow10?.kwh).toBeCloseTo(0.4 * 3 * 0.8, 6);
  });

  it("sans solaire dans le profil : pas de prévision", async () => {
    const base = await createTestHousehold("prevision-sans-solaire");
    await updateProfile(base, { ...base.profile, solar: false });
    expect(await getSolarForecast(await householdContextFor(base.userId), now)).toBeNull();
  });
});
