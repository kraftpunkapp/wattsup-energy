import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { shiftableAppliance } from "@/db/schema";
import { APPLIANCE_PRESETS, MAX_APPLIANCES } from "@/domain/forecast/appliances";
import { deleteAppliance, listAppliances, saveAppliance } from "@/server/appliances";
import { ContractError } from "@/server/contracts";
import { createTestHousehold, describeTenantIsolation } from "../helpers/tenancy";

// Appareils déplaçables (T71, SPEC §7.14).

const washer = APPLIANCE_PRESETS[0] as (typeof APPLIANCE_PRESETS)[number];

describe("appareils déplaçables", () => {
  it("ajouter, modifier, supprimer ; dans l'ordre d'ajout", async () => {
    const ctx = await createTestHousehold("appareils");
    const a = await saveAppliance(ctx, null, washer);
    await saveAppliance(ctx, null, { ...washer, name: "Sèche-linge" });
    expect((await listAppliances(ctx)).map((x) => x.name)).toEqual(["Lave-linge", "Sèche-linge"]);
    await saveAppliance(ctx, a?.id ?? "", { ...washer, powerKw: 2.2 });
    expect((await listAppliances(ctx))[0]?.powerKw).toBeCloseTo(2.2, 6);
    expect(await deleteAppliance(ctx, a?.id ?? "")).toBe(true);
    expect((await listAppliances(ctx)).map((x) => x.name)).toEqual(["Sèche-linge"]);
  });

  it(`${MAX_APPLIANCES} appareils au plus`, async () => {
    const ctx = await createTestHousehold("appareils");
    for (let i = 0; i < MAX_APPLIANCES; i++)
      await saveAppliance(ctx, null, { ...washer, name: `A${i}` });
    await expect(saveAppliance(ctx, null, washer)).rejects.toThrow(ContractError);
  });
});

const ownedByB = async (b: Parameters<typeof listAppliances>[0]) =>
  (await saveAppliance(b, null, washer))?.id ?? "";
const untouched = async (_b: unknown, id: string) => {
  const [row] = await db.select().from(shiftableAppliance).where(eq(shiftableAppliance.id, id));
  expect(row).toMatchObject({ name: "Lave-linge", powerKw: 2 });
};

describeTenantIsolation("liste des appareils", {
  setup: ownedByB,
  attempt: (a) => listAppliances(a),
  expect: "empty",
});
describeTenantIsolation("modification d'un appareil", {
  setup: ownedByB,
  attempt: (a, id) => saveAppliance(a, id, { ...washer, name: "piraté" }),
  expect: "empty",
  untouched,
});
describeTenantIsolation("suppression d'un appareil", {
  setup: ownedByB,
  attempt: async (a, id) => ((await deleteAppliance(a, id)) ? id : null),
  expect: "empty",
  untouched,
});
