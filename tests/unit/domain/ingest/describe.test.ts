import { describe, expect, it } from "vitest";
import { describeLogError, describeWarnings } from "@/domain/ingest/describe";

const names = { "chauffe-eau": "Chauffe-eau", "charge-voiture": "Charge voiture" };

describe("describeWarnings", () => {
  it("regroupe les compteurs d'un même avertissement, en une phrase lisible", () => {
    expect(
      describeWarnings(
        [
          { code: "gap_too_long", metric: "grid_import", hours: 24 },
          { code: "gap_too_long", metric: "grid_export", hours: 24 },
          { code: "gap_too_long", metric: "battery_charge", hours: 24 },
          { code: "baseline", metric: "category:chauffe-eau" },
          { code: "baseline", metric: "category:charge-voiture" },
        ],
        names,
      ),
    ).toEqual([
      {
        tone: "info",
        text: "Import réseau, export réseau et charge batterie : 24 h sans relevé, période non comptée.",
      },
      {
        tone: "info",
        text: "Chauffe-eau et Charge voiture : premier relevé, comptage à partir du prochain envoi.",
      },
    ]);
  });

  it("des trous de durées différentes restent distincts ; au-delà de 48 h, en jours", () => {
    expect(
      describeWarnings(
        [
          { code: "gap_too_long", metric: "grid_import", hours: 30 },
          { code: "gap_too_long", metric: "solar_production", hours: 73 },
        ],
        {},
      ).map((w) => w.text),
    ).toEqual([
      "Import réseau : 30 h sans relevé, période non comptée.",
      "Production solaire : 3 jours sans relevé, période non comptée.",
    ]);
  });

  it("signale en avertissement ce qui demande une vérification", () => {
    expect(
      describeWarnings(
        [
          { code: "reset", metric: "battery_discharge" },
          { code: "out_of_order", metric: "grid_import" },
          { code: "invalid_value", metric: "battery_charge_grid" },
          { code: "implausible", metric: "grid_import", kwhPerHour: 52.4 },
          { code: "unknown_category", key: "piscine" },
          { code: "no_energy_data" },
        ],
        {},
      ),
    ).toEqual([
      {
        tone: "warning",
        text: "Décharge batterie : compteur remis à zéro, nouveau point de départ.",
      },
      { tone: "warning", text: "Import réseau : relevé plus ancien que le précédent, ignoré." },
      { tone: "warning", text: "Charge batterie depuis le réseau : valeur invalide, ignorée." },
      {
        tone: "warning",
        text: "Import réseau : 52,4 kWh en une heure, valeur inhabituelle à vérifier.",
      },
      {
        tone: "warning",
        text: "Poste « piscine » inconnu : créez-le dans Postes ou corrigez son slug dans Home Assistant.",
      },
      {
        tone: "warning",
        text: "Aucune valeur d'énergie reçue : dans l'automatisation WattsUp de Home Assistant, choisissez au moins le capteur « Import réseau » et vérifiez qu'il a une valeur.",
      },
    ]);
    expect(describeWarnings([{ code: "missing_grid_import" }], {})).toEqual([
      {
        tone: "warning",
        text: "Pas d'import réseau dans cet envoi : l'électricité achetée et son coût ne sont pas comptés. Choisissez le capteur « Import réseau » dans l'automatisation WattsUp et vérifiez qu'il a une valeur.",
      },
    ]);
  });

  it("poste supprimé depuis : slug affiché ; entrée illisible ou bloc ignoré", () => {
    expect(
      describeWarnings(
        [
          { code: "baseline", metric: "category:ancien" },
          { code: "ignored_block", key: "fuel" },
          { code: "futur" },
          "texte",
        ],
        {},
      ).map((w) => w.text),
    ).toEqual([
      "« ancien » : premier relevé, comptage à partir du prochain envoi.",
      "Bloc « fuel » non exploité par cette version.",
    ]);
  });
});

describe("describeWarnings — historique", () => {
  it("résume l'envoi : ajoutées, présentes, rejetées, quota", () => {
    expect(
      describeWarnings(
        [
          {
            code: "backfill",
            inserted: 1200,
            existing: 48,
            rejected: { implausible: 2, negative: 0, outOfRange: 1, unknownCategory: 0 },
            quotaReached: true,
          },
        ],
        {},
      ).map((l) => [l.tone, l.text.replace(/\u202f/g, " ")]),
    ).toEqual([
      ["info", "Historique : 1 200 valeurs ajoutées, 48 déjà présentes (conservées)."],
      ["warning", "3 valeurs rejetées : 2 invraisemblables, 1 hors période."],
      ["warning", "Quota de valeurs du foyer atteint : la fin de l'envoi n'est pas enregistrée."],
    ]);
  });
});

describe("describeWarnings — décompte de combustible", () => {
  it("quantité et stock restant", () => {
    expect(
      describeWarnings(
        [{ code: "fuel_event", fuel: "granulés", qty: 1, stock: 41.5, unit: "sacs" }],
        {},
      ).map((l) => l.text),
    ).toEqual(["Décompte depuis Home Assistant : 1 sac de granulés ; stock restant 41,5 sacs."]);
  });
});

describe("describeLogError", () => {
  it("erreurs de validation (JSON stocké) : une ligne par champ", () => {
    expect(
      describeLogError(
        JSON.stringify([
          { path: "energy.grid_import_kwh", message: "nombre attendu" },
          { path: "", message: "JSON invalide" },
        ]),
      ),
    ).toEqual(["energy.grid_import_kwh : nombre attendu", "JSON invalide"]);
  });

  it("message simple tel quel", () => {
    expect(describeLogError("trop de requêtes : 120 par minute au maximum")).toEqual([
      "trop de requêtes : 120 par minute au maximum",
    ]);
  });
});
