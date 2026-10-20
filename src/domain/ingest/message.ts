import { describeLogError, describeWarnings } from "./describe";

// Champ `message` des réponses d'ingestion (SPEC §6.3, ajout compatible avec le contrat v1) :
// une phrase en français, prête à afficher dans la notification de Home Assistant, au lieu
// des codes bruts. Absent quand l'envoi est accepté sans rien à vérifier.

const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

export function ingestMessage(status: number, body: Record<string, unknown>): string | undefined {
  if (status === 200) {
    const warnings = Array.isArray(body.warnings) ? body.warnings : [];
    const lines = describeWarnings(warnings, {}).filter((l) => l.tone === "warning");
    return lines.length > 0 ? lines.map((l) => l.text).join(" ") : undefined;
  }
  if (status === 401) {
    return "Token refusé (absent, invalide ou révoqué) : créez-en un dans WattsUp › Réglages › Home Assistant, puis copiez-le dans le rest_command « wattsup_push ».";
  }
  if (Array.isArray(body.errors)) {
    return sentence(
      `Envoi refusé, contenu invalide : ${describeLogError(JSON.stringify(body.errors)).join(" ; ")}`,
    );
  }
  return typeof body.error === "string" ? sentence(`Envoi refusé : ${body.error}`) : undefined;
}
