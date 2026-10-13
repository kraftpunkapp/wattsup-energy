import { getHouseholdContext, UnauthorizedError, type HouseholdContext } from "@/server/context";

/** Contexte de la session, ou réponse 401 (les routes /api ne passent pas par le middleware). */
export async function sessionContext(): Promise<HouseholdContext | Response> {
  try {
    return await getHouseholdContext();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return Response.json({ error: "non authentifié" }, { status: 401 });
    }
    throw err;
  }
}
