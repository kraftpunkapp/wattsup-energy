import { exportFilename } from "@/domain/export";
import { localParts } from "@/lib/time";
import { exportData } from "@/server/export";
import { sessionContext } from "../../session";
import { attachment } from "../session";

// Export de tout le reste (T46) : compte, foyer, réglages, postes, contrats, combustibles,
// équipements, repères, en JSON lisible.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await sessionContext();
  if (ctx instanceof Response) return ctx;
  const today = localParts(new Date(), ctx.timezone).date;
  return new Response(JSON.stringify(await exportData(ctx), null, 2), {
    headers: attachment(exportFilename("donnees", today), "application/json; charset=utf-8"),
  });
}
