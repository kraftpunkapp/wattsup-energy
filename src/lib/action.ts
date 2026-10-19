// Appel d'une Server Action depuis l'interface (T60) : réseau coupé ou serveur indisponible,
// l'appel échoue sans résultat ; il devient un refus lisible, affiché comme les refus métier,
// et la saisie reste à l'écran. Les signaux de Next.js (redirection, page introuvable) passent.

export const UNREACHABLE =
  "Le serveur n'a pas répondu : vérifiez votre connexion, puis réessayez.";

const isNextSignal = (err: unknown) =>
  typeof (err as { digest?: unknown } | null)?.digest === "string" &&
  ((err as { digest: string }).digest.startsWith("NEXT_") ||
    (err as { digest: string }).digest.startsWith("HTTP_ERROR_FALLBACK"));

export async function callAction<T>(fn: () => Promise<T>): Promise<T | { ok: false; errors: string[] }> {
  try {
    return await fn();
  } catch (err) {
    if (isNextSignal(err)) throw err;
    console.error(err);
    return { ok: false, errors: [UNREACHABLE] };
  }
}
