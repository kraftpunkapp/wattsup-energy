import { getLastPushAt } from "@/server/ingest/status";
import { sessionContext } from "../session";

// Dernier push de Home Assistant, relu par le bloc du menu (HaStatus) : le layout n'est pas
// recalculé à la navigation, et une requête simple n'interfère pas avec le routeur.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await sessionContext();
  if (ctx instanceof Response) return ctx;
  const at = await getLastPushAt(ctx);
  return Response.json(
    { lastPushAt: at?.toISOString() ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
