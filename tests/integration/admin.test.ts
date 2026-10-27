import { setManualSobriety } from "@/server/calendars";
import { eq, is } from "drizzle-orm";
import { PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { account, household, session, user } from "@/db/schema";
import { CONTRACT_PRESETS } from "@/domain/tariff/schema";
import {
  AdminError,
  deleteUserAsAdmin,
  ForbiddenError,
  listUsers,
  setUserDisabled,
} from "@/server/admin";
import { auth } from "@/server/auth";
import { createCategory } from "@/server/categories";
import type { HouseholdContext } from "@/server/context";
import { createContract } from "@/server/contracts";
import { saveEquipment } from "@/server/equipment";
import { addPurchase } from "@/server/fuel";
import { createMarker } from "@/server/markers";
import { saveAppliance } from "@/server/appliances";
import { APPLIANCE_PRESETS } from "@/domain/forecast/appliances";
import { dismissAlert } from "@/server/alerts";
import { ingest } from "@/server/ingest/persist";
import { createIngestToken, verifyIngestToken } from "@/server/ingest/token";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

const PASSWORD = "motdepasse-de-test";

/** Foyer de test promu administrateur (comme la migration le fait pour l'instance de référence). */
async function createAdmin(): Promise<HouseholdContext> {
  const ctx = await createTestHousehold("admin");
  await db.update(user).set({ isAdmin: true }).where(eq(user.id, ctx.userId));
  return { ...ctx, isAdmin: true };
}

const emailOf = async (userId: string) =>
  (await db.select({ email: user.email }).from(user).where(eq(user.id, userId)))[0]?.email ?? "";

const signIn = async (userId: string) =>
  auth.api.signInEmail({ body: { email: await emailOf(userId), password: PASSWORD } });

/** Tables du schéma qui portent household_id. */
type HouseholdTable = PgTable & { householdId: PgColumn };
function householdTables(): [string, HouseholdTable][] {
  return (Object.entries(schema) as [string, unknown][])
    .filter(([, t]) => is(t, PgTable) && "householdId" in t)
    .map(([name, t]) => [name, t as HouseholdTable]);
}

/** Une ligne au moins dans chaque table du foyer. */
async function seedEverything(ctx: HouseholdContext) {
  await createIngestToken(ctx);
  await createCategory(ctx, {
    name: "Eau",
    slug: "eau",
    icon: "droplet",
    color: "grid",
    isHeating: false,
  });
  await createContract(ctx, { ...preset, subscription: null });
  await addPurchase(ctx, { fuel: "pellet", qty: 1, unit: "bag", priceEur: 7, date: "2026-01-01" });
  await saveEquipment(ctx, "solar", {
    label: "P",
    capacity: 1,
    installedOn: "2025-01-01",
    costEur: 1,
  });
  await dismissAlert(ctx, "ha_silent", 1);
  await db
    .insert(schema.alertNotification)
    .values({ householdId: ctx.householdId, key: "ha_silent", channel: "email", level: 1 });
  await db.insert(schema.pushSubscription).values({
    householdId: ctx.householdId,
    endpoint: `https://push.example.test/${ctx.householdId}`,
    p256dh: "cle",
    auth: "secret",
    label: "Chrome sur Android",
  });
  await setManualSobriety(ctx.householdId, "2026-01-15", true);
  await saveAppliance(ctx, null, APPLIANCE_PRESETS[0] as (typeof APPLIANCE_PRESETS)[number]);
  await db.insert(schema.batteryLevel).values({
    householdId: ctx.householdId,
    socPercent: 50,
    measuredAt: new Date("2026-10-02T10:00:00Z"),
  });
  await db.insert(schema.householdForecast).values({
    householdId: ctx.householdId,
    start: new Date("2026-10-02T10:00:00Z"),
    solarKwh: 1,
    loadKwh: 1,
  });
  await createMarker(ctx, {
    kind: "other",
    text: "Repère",
    startDate: "2026-01-01",
    endDate: null,
  });
  await ingest(
    ctx.householdId,
    JSON.stringify({
      version: 1,
      ts: "2026-10-01T10:00:00Z",
      energy: { grid_import_kwh: 10 },
      tempo_color: "bleu",
    }),
  );
  await ingest(
    ctx.householdId,
    JSON.stringify({ version: 1, ts: "2026-10-01T11:00:00Z", energy: { grid_import_kwh: 11 } }),
  );
}

const preset = CONTRACT_PRESETS[0] ?? {
  name: "Base",
  contract: { kind: "base" as const, subscriptionEurYear: 200, priceEurKwh: 0.25 },
};

describe("compte administrateur", () => {
  it("le statut n'est pas saisissable à l'inscription", async () => {
    await createAdmin(); // sinon le premier compte de l'instance devient administrateur
    const res = await auth.api
      .signUpEmail({
        body: {
          email: `intrus-${Date.now()}@wattsup.test`,
          password: PASSWORD,
          name: "Intrus",
          isAdmin: true,
        } as never,
      })
      .catch(() => null);
    if (res) {
      const [row] = await db.select().from(user).where(eq(user.id, res.user.id));
      expect(row?.isAdmin).toBe(false);
    }
  });

  it("liste des comptes : profil, postes, valeurs enregistrées et dernier envoi", async () => {
    const admin = await createAdmin();
    const b = await createTestHousehold("b");
    await createCategory(b, {
      name: "Eau chaude",
      slug: "eau-chaude",
      icon: "droplet",
      color: "grid",
      isHeating: false,
    });
    await ingest(
      b.householdId,
      JSON.stringify({ version: 1, ts: "2026-10-01T10:00:00Z", energy: { grid_import_kwh: 10 } }),
    );
    await ingest(
      b.householdId,
      JSON.stringify({ version: 1, ts: "2026-10-01T11:00:00Z", energy: { grid_import_kwh: 11 } }),
    );

    const rows = await listUsers(admin);
    const row = rows.find((r) => r.id === b.userId);
    expect(row).toMatchObject({ name: "b", categories: 1, isAdmin: false, disabledAt: null });
    expect(row?.values).toBeGreaterThan(0);
    expect(row?.lastPushAt).toBeInstanceOf(Date);
    expect(row?.granularity).toBe("hourly");
    // Aucun envoi : pas de date.
    expect(rows.find((r) => r.id === admin.userId)?.lastPushAt).toBeNull();
    expect(row?.profile).toMatchObject({ solar: false });
    expect(rows.find((r) => r.id === admin.userId)?.isAdmin).toBe(true);
  });

  it("désactiver : sessions fermées, connexion et envois refusés ; réactiver rétablit tout", async () => {
    const admin = await createAdmin();
    const b = await createTestHousehold("b");
    const { token } = await createIngestToken(b);
    await signIn(b.userId);
    expect(await db.$count(session, eq(session.userId, b.userId))).toBeGreaterThan(0);

    expect(await setUserDisabled(admin, b.userId, true)).toBe(true);
    expect(await db.$count(session, eq(session.userId, b.userId))).toBe(0);
    await expect(signIn(b.userId)).rejects.toThrow(/désactivé/);
    expect(await verifyIngestToken(`Bearer ${token}`)).toBeNull();

    expect(await setUserDisabled(admin, b.userId, false)).toBe(true);
    expect((await signIn(b.userId)).token).toBeTruthy();
    expect(await verifyIngestToken(`Bearer ${token}`)).not.toBeNull();
  });

  it("supprimer : compte, foyer et toutes les tables du foyer vidés (aucune ligne restante)", async () => {
    const admin = await createAdmin();
    const b = await createTestHousehold("b");
    const keep = await createTestHousehold("voisin");
    for (const ctx of [b, keep]) await seedEverything(ctx);
    await signIn(b.userId);

    // Toutes les tables qui portent household_id, découvertes dans le schéma : une table
    // ajoutée plus tard sans être alimentée ici fait échouer le test (à compléter).
    const tables = householdTables();
    expect(tables.map(([name]) => name)).toEqual(
      expect.arrayContaining(["energyInterval", "contractPeriod", "marker", "fuelEvent"]),
    );
    const count = (hid: string) =>
      Promise.all(
        tables.map(async ([name, t]) => [name, await db.$count(t, eq(t.householdId, hid))]),
      );
    const before = Object.fromEntries(await count(b.householdId));
    expect(Object.entries(before).filter(([, n]) => n === 0)).toEqual([]);

    expect(await deleteUserAsAdmin(admin, b.userId)).toBe(true);

    const after = Object.fromEntries(await count(b.householdId));
    expect(
      Object.values(after).every((n) => n === 0),
      JSON.stringify(after),
    ).toBe(true);
    expect(await db.$count(user, eq(user.id, b.userId))).toBe(0);
    expect(await db.$count(session, eq(session.userId, b.userId))).toBe(0);
    expect(await db.$count(account, eq(account.userId, b.userId))).toBe(0);
    expect(await db.$count(household, eq(household.id, b.householdId))).toBe(0);
    // Le foyer voisin n'a rien perdu.
    expect(Object.fromEntries(await count(keep.householdId))).toEqual(before);
    expect(await deleteUserAsAdmin(admin, b.userId)).toBe(false);
  }, 30_000);

  it("jamais sur son propre compte ni sur un autre administrateur", async () => {
    const admin = await createAdmin();
    const other = await createAdmin();
    await expect(setUserDisabled(admin, admin.userId, true)).rejects.toThrow(AdminError);
    await expect(deleteUserAsAdmin(admin, admin.userId)).rejects.toThrow(AdminError);
    await expect(deleteUserAsAdmin(admin, other.userId)).rejects.toThrow(AdminError);
    expect(await db.$count(user, eq(user.id, other.userId))).toBe(1);
  });

  it("réservé à l'administrateur : un compte ordinaire est refusé", async () => {
    const a = await createTestHousehold("a");
    await expect(listUsers(a)).rejects.toThrow(ForbiddenError);
  });
});

describeTenantIsolation("désactiver un compte (non administrateur)", {
  setup: async (b) => b.userId,
  attempt: (a, id) => setUserDisabled(a, id, true),
  expect: "throws",
  untouched: async (_b, id) => {
    const [row] = await db.select().from(user).where(eq(user.id, id));
    expect(row?.disabledAt).toBeNull();
  },
});

describeTenantIsolation("supprimer un compte (non administrateur)", {
  setup: async (b) => b.userId,
  attempt: (a, id) => deleteUserAsAdmin(a, id),
  expect: "throws",
  untouched: async (_b, id) => {
    expect(await db.$count(user, eq(user.id, id))).toBe(1);
  },
});

describe("premier administrateur", () => {
  it("le premier compte d'une instance sans administrateur le devient, pas le suivant", async () => {
    const admins = await db.select({ id: user.id }).from(user).where(eq(user.isAdmin, true));
    await db.update(user).set({ isAdmin: false });
    try {
      const signUp = (n: number) =>
        auth.api.signUpEmail({
          body: { email: `first-${Date.now()}-${n}@wattsup.test`, password: PASSWORD, name: "P" },
        });
      const first = await signUp(1);
      const second = await signUp(2);
      const isAdmin = async (id: string) =>
        (await db.select({ a: user.isAdmin }).from(user).where(eq(user.id, id)))[0]?.a;
      expect(await isAdmin(first.user.id)).toBe(true);
      expect(await isAdmin(second.user.id)).toBe(false);
      await db.update(user).set({ isAdmin: false }).where(eq(user.id, first.user.id));
    } finally {
      for (const a of admins) await db.update(user).set({ isAdmin: true }).where(eq(user.id, a.id));
    }
  });
});
