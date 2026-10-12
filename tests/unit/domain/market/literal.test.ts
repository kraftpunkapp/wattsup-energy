import { describe, expect, it } from "vitest";
import { findCallArguments, parseLiteral } from "@/domain/market/literal";

// Les fichiers de la source sont des scripts : on n'en lit que les littéraux, sans jamais
// les exécuter (SPEC §7.12).

describe("parseLiteral", () => {
  it("lit objets, tableaux, chaînes, nombres, booléens et null", () => {
    expect(parseLiteral(`{ a: 1, "b": -2.5e1, c: [true, false, null], d: 'x', 7: "y" }`)).toEqual({
      a: 1,
      b: -25,
      c: [true, false, null],
      d: "x",
      "7": "y",
    });
  });

  it("ignore les commentaires et accepte les virgules finales", () => {
    const src = `{
      // une ligne
      a: 1, /* bloc */ b: [1, 2,],
    }`;
    expect(parseLiteral(src)).toEqual({ a: 1, b: [1, 2] });
  });

  it("décode les échappements de chaînes", () => {
    expect(parseLiteral(`"a\\"b\\\\c\\n\\u00e9"`)).toBe('a"b\\c\né');
    expect(parseLiteral(`"Charge'Heures"`)).toBe("Charge'Heures");
  });

  it.each([
    ["un identifiant", "{ a: window }"],
    ["un appel", "{ a: f() }"],
    ["un gabarit", "{ a: `x` }"],
    ["une opération sur un identifiant", "{ a: 1 + x }"],
    ["une concaténation", `{ a: "a" + "b" }`],
    ["une division par zéro", "{ a: 1 / 0 }"],
    ["une fonction", "{ a: function () {} }"],
    ["une décomposition", "{ ...x }"],
    ["une clé calculée", "{ [a]: 1 }"],
  ])("refuse %s", (_label, src) => {
    expect(() => parseLiteral(src)).toThrow();
  });

  it("calcule l'arithmétique sur des nombres", () => {
    expect(parseLiteral("{ a: (47.88 + 99.37) / 12, b: 2 * -3 + 1, c: -(1 - 4) }")).toEqual({
      a: (47.88 + 99.37) / 12,
      b: -5,
      c: 3,
    });
  });

  it("refuse les clés qui toucheraient au prototype", () => {
    expect(() => parseLiteral(`{ __proto__: { x: 1 } }`)).toThrow(/clé interdite/);
    expect(() => parseLiteral(`{ "constructor": 1 }`)).toThrow(/clé interdite/);
  });

  it("refuse un texte inachevé ou suivi d'autre chose", () => {
    expect(() => parseLiteral(`{ a: 1`)).toThrow();
    expect(() => parseLiteral(`"abc`)).toThrow();
    expect(() => parseLiteral(`1 2`)).toThrow();
  });

  it("borne la profondeur", () => {
    expect(() => parseLiteral("[".repeat(100) + "]".repeat(100))).toThrow(/profondeur/);
  });
});

describe("findCallArguments", () => {
  it("renvoie l'argument de chaque appel, hors commentaires et chaînes", () => {
    const src = `
      // defineTarif({ name: "commenté" })
      const s = "defineTarif({ name: 'chaîne' })";
      defineTarif({ name: "A" });
      defineTarif ( { name: "B", n: [1] } );
    `;
    expect(findCallArguments(src, "defineTarif")).toEqual([
      { ok: true, value: { name: "A" } },
      { ok: true, value: { name: "B", n: [1] } },
    ]);
  });

  it("isole un appel illisible sans perdre les autres", () => {
    const src = `defineTarif({ name: "A", x: compute() });\ndefineTarif({ name: "B" });`;
    const [first, second] = findCallArguments(src, "defineTarif");
    expect(first?.ok).toBe(false);
    expect(second).toEqual({ ok: true, value: { name: "B" } });
  });

  it("ne confond pas un nom plus long", () => {
    expect(findCallArguments(`mydefineTarif({ a: 1 }); defineTarifs({})`, "defineTarif")).toEqual(
      [],
    );
  });
});
