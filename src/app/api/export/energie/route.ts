import { exportFilename } from "@/domain/export";
import { localParts } from "@/lib/time";
import { energyCsvChunks } from "@/server/export";
import { sessionContext } from "../../session";
import { attachment } from "../session";

// Export de l'énergie (T46) : CSV au format de l'import, envoyé en flux.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await sessionContext();
  if (ctx instanceof Response) return ctx;
  const encoder = new TextEncoder();
  const chunks = energyCsvChunks(ctx);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
  });
  const today = localParts(new Date(), ctx.timezone).date;
  return new Response(body, {
    headers: attachment(exportFilename("energie", today), "text/csv; charset=utf-8"),
  });
}
