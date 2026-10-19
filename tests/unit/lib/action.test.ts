import { describe, expect, it } from "vitest";
import { callAction, UNREACHABLE } from "@/lib/action";

// Appel d'une Server Action depuis l'interface (T60) : un échec réseau ou serveur devient un
// refus lisible au lieu de faire planter l'écran ; une redirection de Next.js passe.

describe("callAction", () => {
  it("rend le résultat de l'action", async () => {
    expect(await callAction(async () => ({ ok: true as const, id: "x" }))).toEqual({
      ok: true,
      id: "x",
    });
  });

  it("serveur injoignable : refus avec un message en français", async () => {
    const r = await callAction(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(r).toEqual({ ok: false, errors: [UNREACHABLE] });
  });

  it("une redirection de Next.js n'est pas avalée", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/;307;" });
    await expect(
      callAction(async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);
  });
});
