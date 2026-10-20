import { describe, expect, it } from "vitest";
import { ingestMessage } from "@/domain/ingest/message";

// Message de la réponse d'ingestion (champ `message`, SPEC §6.3) : une phrase en français
// que le blueprint affiche telle quelle dans la notification de Home Assistant.

describe("ingestMessage", () => {
  it("envoi accepté : seulement ce qui demande une vérification", () => {
    expect(ingestMessage(200, { ok: true, warnings: [] })).toBeUndefined();
    expect(
      ingestMessage(200, { ok: true, warnings: [{ code: "baseline", metric: "grid_import" }] }),
    ).toBeUndefined();
    expect(ingestMessage(200, { ok: true, warnings: [{ code: "no_energy_data" }] })).toBe(
      "Aucune valeur d'énergie reçue : dans l'automatisation WattsUp de Home Assistant, choisissez au moins le capteur « Import réseau » et vérifiez qu'il a une valeur.",
    );
    expect(
      ingestMessage(200, {
        ok: true,
        warnings: [
          { code: "reset", metric: "battery_discharge" },
          { code: "unknown_category", key: "piscine" },
        ],
      }),
    ).toBe(
      "Décharge batterie : compteur remis à zéro, nouveau point de départ. Poste « piscine » inconnu : créez-le dans Postes ou corrigez son slug dans Home Assistant.",
    );
  });

  it("refus : contenu invalide, token, granularité, débit", () => {
    expect(
      ingestMessage(400, {
        ok: false,
        errors: [{ path: "energy.grid_import_kwh", message: "nombre attendu" }],
      }),
    ).toBe("Envoi refusé, contenu invalide : energy.grid_import_kwh : nombre attendu.");
    expect(ingestMessage(401, { ok: false })).toBe(
      "Token refusé (absent, invalide ou révoqué) : créez-en un dans WattsUp › Réglages › Home Assistant, puis copiez-le dans le rest_command « wattsup_push ».",
    );
    expect(
      ingestMessage(409, { ok: false, error: "ce foyer attend des envois en mode horaire" }),
    ).toBe("Envoi refusé : ce foyer attend des envois en mode horaire.");
    expect(ingestMessage(429, { ok: false, error: "trop de requêtes" })).toBe(
      "Envoi refusé : trop de requêtes.",
    );
  });
});
