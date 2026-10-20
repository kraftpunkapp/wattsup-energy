import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/v1/ingest/route";
import { db } from "@/db";
import { category, energyInterval, ingestLog, meterState, tempoOverride } from "@/db/schema";
import { updateGranularity } from "@/server/household";
import { createIngestToken } from "@/server/ingest/token";
import type { HouseholdContext } from "@/server/context";
import { createTestHousehold } from "../helpers/tenancy";

async function setup(granularity: "hourly" | "daily" = "hourly") {
  const ctx = await createTestHousehold("ingest");
  if (granularity === "daily") await updateGranularity(ctx, "daily");
  const { token } = await createIngestToken(ctx);
  const push = async (body: unknown, auth = `Bearer ${token}`) => {
    const res = await POST(
      new Request("http://localhost/api/v1/ingest", {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  return { ctx, push };
}

const intervals = (ctx: HouseholdContext, metric: string) =>
  db
    .select()
    .from(energyInterval)
    .where(and(eq(energyInterval.householdId, ctx.householdId), eq(energyInterval.metric, metric)))
    .orderBy(energyInterval.start, energyInterval.tariffSlot);

const hourly = (ts: string, gridImport: number, extra: Record<string, unknown> = {}) => ({
  version: 1,
  ts,
  energy: { grid_import_kwh: gridImport },
  ...extra,
});

describe("POST /api/v1/ingest : authentification et validation", () => {
  it("401 sans token, avec un token invalide ou mal formé", async () => {
    const { push } = await setup();
    for (const auth of ["", "Bearer wu_faux", "Bearer " + "wu_" + "A".repeat(43)]) {
      const r = await push(hourly("2026-10-02T12:00:00Z", 1), auth);
      expect(r.status).toBe(401);
      expect(r.json).toMatchObject({ ok: false, message: expect.stringContaining("Token refusé") });
    }
  });

  it("400 sur JSON invalide, journalisé", async () => {
    const { ctx, push } = await setup();
    const r = await push("{pas du json");
    expect(r.status).toBe(400);
    expect(r.json.errors).toEqual([{ path: "", message: "JSON invalide" }]);
    const logs = await db
      .select()
      .from(ingestLog)
      .where(eq(ingestLog.householdId, ctx.householdId));
    expect(logs.map((l) => l.httpStatus)).toEqual([400]);
  });

  it("400 sur schéma invalide avec le chemin du champ", async () => {
    const { push } = await setup();
    const r = await push({
      version: 1,
      ts: "2026-10-02T12:00:00Z",
      energy: { grid_import_kwh: -2 },
    });
    expect(r.status).toBe(400);
    expect((r.json.errors as { path: string }[])[0]?.path).toBe("energy.grid_import_kwh");
    expect(r.json.message).toMatch(/^Envoi refusé, contenu invalide : energy\.grid_import_kwh/);
  });
});

describe("mode horaire", () => {
  it("premier push = référence, second push = un intervalle horaire", async () => {
    const { ctx, push } = await setup();
    const first = await push(hourly("2026-10-02T12:00:00Z", 1000));
    expect(first.status).toBe(200);
    expect(first.json.warnings).toEqual([{ code: "baseline", metric: "grid_import" }]);
    expect(await intervals(ctx, "grid_import")).toHaveLength(0);

    const second = await push(hourly("2026-10-02T13:00:00Z", 1000.75));
    expect(second.json).toEqual({ ok: true, warnings: [] });
    const rows = await intervals(ctx, "grid_import");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.start.toISOString()).toBe("2026-10-02T12:00:00.000Z");
    expect(rows[0]?.kwh).toBeCloseTo(0.75, 4);

    const [state] = await db
      .select()
      .from(meterState)
      .where(eq(meterState.householdId, ctx.householdId));
    expect(state?.value).toBe(1000.75);
  });

  it("pushes décalés : les parts d'une même heure se cumulent", async () => {
    const { ctx, push } = await setup();
    await push(hourly("2026-10-02T12:30:00Z", 0));
    await push(hourly("2026-10-02T13:30:00Z", 1)); // 0,5 sur 12h, 0,5 sur 13h
    await push(hourly("2026-10-02T14:30:00Z", 2)); // 0,5 sur 13h, 0,5 sur 14h
    const rows = await intervals(ctx, "grid_import");
    expect(rows.map((r) => [r.start.toISOString().slice(11, 13), r.kwh])).toEqual([
      ["12", 0.5],
      ["13", 1],
      ["14", 0.5],
    ]);
  });

  it("renvoyer le même push ne double pas les données", async () => {
    const { ctx, push } = await setup();
    await push(hourly("2026-10-02T12:00:00Z", 10));
    await push(hourly("2026-10-02T13:00:00Z", 11));
    const again = await push(hourly("2026-10-02T13:00:00Z", 11));
    expect(again.json.warnings).toEqual([{ code: "out_of_order", metric: "grid_import" }]);
    expect((await intervals(ctx, "grid_import"))[0]?.kwh).toBe(1);
  });

  it("une heure importée par CSV est remplacée par HA", async () => {
    const { ctx, push } = await setup();
    await db.insert(energyInterval).values({
      householdId: ctx.householdId,
      metric: "grid_import",
      start: new Date("2026-10-02T12:00:00Z"),
      granularity: "hour",
      kwh: 9,
      source: "csv",
    });
    await push(hourly("2026-10-02T12:00:00Z", 100));
    await push(hourly("2026-10-02T13:00:00Z", 101.5));
    const [row] = await intervals(ctx, "grid_import");
    expect(row).toMatchObject({ kwh: 1.5, source: "ha" });
  });

  it("catégories connues stockées, inconnues signalées", async () => {
    const { ctx, push } = await setup();
    await db
      .insert(category)
      .values({ householdId: ctx.householdId, name: "Eau chaude", slug: "eau-chaude" });
    await push(hourly("2026-10-02T12:00:00Z", 0, { categories: { "eau-chaude": 50, piscine: 3 } }));
    const r = await push(
      hourly("2026-10-02T13:00:00Z", 1, { categories: { "eau-chaude": 50.4, piscine: 4 } }),
    );
    expect(r.json.warnings).toEqual([{ code: "unknown_category", key: "piscine" }]);
    expect(r.json.message).toBe(
      "Poste « piscine » inconnu : créez-le dans Postes ou corrigez son slug dans Home Assistant.",
    );
    expect((await intervals(ctx, "category:eau-chaude"))[0]?.kwh).toBeCloseTo(0.4, 4);
  });

  it("import réseau oublié : accepté, avertissement et message clair (T66)", async () => {
    const { push } = await setup();
    const r = await push({
      version: 1,
      ts: "2026-10-02T12:00:00Z",
      energy: { solar_production_kwh: 120.5 },
    });
    expect(r.status).toBe(200);
    expect(r.json.warnings).toContainEqual({ code: "missing_grid_import" });
    expect(r.json.message).toMatch(/^Pas d'import réseau dans cet envoi/);
  });

  it("envoi sans rien à vérifier : pas de message", async () => {
    const { push } = await setup();
    const r = await push(hourly("2026-10-02T12:00:00Z", 1));
    expect(r.json).not.toHaveProperty("message");
  });

  it("couleur Tempo rattachée au jour Tempo (6 h → 6 h)", async () => {
    const { ctx, push } = await setup();
    await push({ version: 1, ts: "2026-10-02T03:00:00Z", tempo_color: "blanc" }); // 05:00 local
    const [t] = await db
      .select()
      .from(tempoOverride)
      .where(eq(tempoOverride.householdId, ctx.householdId));
    expect(t).toMatchObject({ date: "2026-10-01", color: "blanc", source: "ha" });
  });

  it("le bloc fuel est accepté mais signalé comme non exploité", async () => {
    const { push } = await setup();
    const r = await push({
      version: 1,
      ts: "2026-10-02T12:00:00Z",
      fuel: { pellet_bags_total: 3 },
    });
    expect(r.json.warnings).toEqual([
      { code: "no_energy_data" },
      { code: "ignored_block", key: "fuel" },
    ]);
  });
});

describe("mode quotidien", () => {
  const daily = (hp: number, hc: number) => ({
    version: 1,
    date: "2026-10-01",
    grid_import: { hp_kwh: hp, hc_kwh: hc },
    solar_production_kwh: 11.9,
  });

  it("intervalles journaliers au minuit local, ventilés HP/HC", async () => {
    const { ctx, push } = await setup("daily");
    expect((await push(daily(6.82, 5.31))).status).toBe(200);
    const rows = await intervals(ctx, "grid_import");
    expect(rows.map((r) => [r.tariffSlot, r.kwh, r.granularity])).toEqual([
      ["hc", 5.31, "day"],
      ["hp", 6.82, "day"],
    ]);
    expect(rows[0]?.start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect((await intervals(ctx, "solar_production"))[0]?.tariffSlot).toBe("all");
  });

  it("idempotent : renvoyer la même date remplace les valeurs", async () => {
    const { ctx, push } = await setup("daily");
    await push(daily(6, 5));
    await push(daily(7, 4));
    const rows = await intervals(ctx, "grid_import");
    expect(rows.map((r) => r.kwh)).toEqual([4, 7]);
  });

  it("une correction Tempo manuelle n'est pas écrasée par HA", async () => {
    const { ctx, push } = await setup("daily");
    await db.insert(tempoOverride).values({
      householdId: ctx.householdId,
      date: "2026-10-01",
      color: "rouge",
      source: "manual",
    });
    await push({ version: 1, date: "2026-10-01", tempo_color: "bleu" });
    const [t] = await db
      .select()
      .from(tempoOverride)
      .where(eq(tempoOverride.householdId, ctx.householdId));
    expect(t?.color).toBe("rouge");
  });
});

describe("isolation", () => {
  it("le token d'un foyer n'écrit que dans ce foyer", async () => {
    const a = await setup();
    const b = await setup();
    await a.push(hourly("2026-10-02T12:00:00Z", 0));
    await a.push(hourly("2026-10-02T13:00:00Z", 2));
    expect(await intervals(a.ctx, "grid_import")).toHaveLength(1);
    expect(await intervals(b.ctx, "grid_import")).toHaveLength(0);
  });
});
