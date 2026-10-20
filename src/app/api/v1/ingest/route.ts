import { isBackfill } from "@/domain/ingest/backfill";
import { isFuelEvent } from "@/domain/ingest/fuel-event";
import { ingestMessage } from "@/domain/ingest/message";
import { backfill } from "@/server/ingest/backfill";
import { fuelEvent } from "@/server/ingest/fuel-event";
import { ingest } from "@/server/ingest/persist";
import { verifyIngestToken } from "@/server/ingest/token";
import { ingestRateLimiter } from "@/server/rate-limit";

// POST /api/v1/ingest : point d'entrée des pushes Home Assistant (SPEC §6).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

/** Réponse JSON, avec sa phrase pour la notification de Home Assistant (`message`). */
function reply(status: number, body: object, init: ResponseInit = {}): Response {
  const message = ingestMessage(status, body as Record<string, unknown>);
  return Response.json(message ? { ...body, message } : body, { ...init, status });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await verifyIngestToken(request.headers.get("authorization"));
  if (!auth) return reply(401, { ok: false });

  const limit = ingestRateLimiter.hit(auth.tokenId);
  if (!limit.allowed) {
    return reply(
      429,
      { ok: false, error: "trop de requêtes : 120 par minute au maximum" },
      { headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return tooLarge();
  const body = await readLimited(request, MAX_BODY_BYTES);
  if (body === null) return tooLarge();

  // Décompte d'un combustible (bloc `fuel_event`, §6.5) et historique (bloc `backfill`,
  // §6.4) : traitements à part ; tout autre envoi suit le chemin ordinaire, inchangé.
  const json = parseJson(body);
  if (isFuelEvent(json)) {
    const result = await fuelEvent(auth.householdId, json, body);
    return reply(result.status, result.body);
  }
  if (isBackfill(json)) {
    const result = await backfill(auth.householdId, json, body);
    return reply(result.status, result.body);
  }
  const result = await ingest(auth.householdId, body);
  return reply(result.status, result.body);
}

/**
 * Corps en texte, lu en flux : null dès que `max` octets sont dépassés (un envoi sans
 * content-length n'est donc jamais chargé en entier).
 */
async function readLimited(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null; // le chemin ordinaire journalise le JSON invalide
  }
}

const tooLarge = () => reply(413, { ok: false, error: "corps trop volumineux : 64 Ko au maximum" });
