import { describe, expect, it } from "vitest";
import type { Alert } from "@/domain/alerts";
import {
  alertsEmail,
  confirmEmailEmail,
  contactEmail,
  newIdeaEmail,
  resetPasswordEmail,
  tomorrowEmail,
} from "@/domain/mail";

describe("confirmEmailEmail", () => {
  it("lien de confirmation dans le texte et le HTML, valable une heure ; prénom échappé", () => {
    const m = confirmEmailEmail("<Alex>", "https://wattsup.test/api/auth/verify-email?token=a&b");
    expect(m.subject).toContain("adresse");
    expect(m.text).toContain("https://wattsup.test/api/auth/verify-email?token=a&b");
    expect(m.text).toMatch(/une heure/);
    expect(m.html).toContain('href="https://wattsup.test/api/auth/verify-email?token=a&amp;b"');
    expect(m.html).toContain("&lt;Alex&gt;");
  });
});

describe("resetPasswordEmail", () => {
  it("lien dans le texte et le HTML ; prénom échappé", () => {
    const m = resetPasswordEmail("<Alex>", "https://wattsup.test/reset?token=a&b");
    expect(m.subject).toContain("mot de passe");
    expect(m.text).toContain("https://wattsup.test/reset?token=a&b");
    expect(m.html).toContain('href="https://wattsup.test/reset?token=a&amp;b"');
    expect(m.html).toContain("&lt;Alex&gt;");
    expect(m.html).not.toContain("<Alex>");
  });

  it("sans prénom : formule neutre", () => {
    expect(resetPasswordEmail("", "https://x.test").text.startsWith("Bonjour,")).toBe(true);
  });
});

describe("newIdeaEmail", () => {
  it("titre, description, auteur et lien ; contenu saisi échappé", () => {
    const m = newIdeaEmail({
      title: "Thème <sombre>",
      description: "Pour le soir.\n\nEt la nuit.",
      authorName: "Élise",
      authorEmail: "elise@example.test",
      url: "https://wattsup.test/idees",
    });
    expect(m.subject).toBe("Nouvelle idée : Thème <sombre>");
    expect(m.text).toContain("Élise <elise@example.test>");
    expect(m.text).toContain("Pour le soir.\n\nEt la nuit.");
    expect(m.text).toContain("https://wattsup.test/idees");
    expect(m.html).toContain("Thème &lt;sombre&gt;");
    expect(m.html).not.toContain("<sombre>");
    expect(m.html).toContain('<p style="white-space:pre-wrap">Et la nuit.</p>');
  });
});

describe("contactEmail", () => {
  it("motif dans l'objet, expéditeur et version ; réponse à l'expéditeur", () => {
    const m = contactEmail({
      kind: "bug",
      message:
        "Le graphique <Production> est vide depuis hier et je ne comprends pas pourquoi.\nDétails…",
      name: "Élise",
      email: "elise@example.test",
      version: "0.1.0",
    });
    expect(m.subject).toBe("[Bug] Le graphique <Production> est vide depuis hier et je ne com…");
    expect(m.replyTo).toBe("elise@example.test");
    expect(m.text).toContain("Signaler un bug — Élise <elise@example.test>, WattsUp 0.1.0");
    expect(m.html).toContain("&lt;Production&gt;");
    expect(m.html).not.toContain("<Production>");
    expect(
      contactEmail({
        ...m,
        kind: "contact",
        message: "Bonjour",
        name: "A",
        email: "a@b.c",
        version: "1",
      }).subject,
    ).toBe("[Contact] Bonjour");
  });
});

describe("alertsEmail", () => {
  const alert = (key: string, title: string): Alert => ({
    key,
    kind: "ha_silent",
    level: 1,
    title,
    text: "Dernier envoi reçu il y a 9 h.",
    href: "/reglages?onglet=home-assistant",
    action: "Voir les derniers envois",
    nav: null,
  });

  it("une alerte : son titre en objet ; liens absolus et lien pour arrêter", () => {
    const m = alertsEmail([alert("ha_silent", "Home Assistant <silencieux>")], "https://w.test");
    expect(m.subject).toBe("WattsUp : Home Assistant <silencieux>");
    expect(m.text).toContain(
      "Voir les derniers envois : https://w.test/reglages?onglet=home-assistant",
    );
    expect(m.text).toContain("https://w.test/reglages?onglet=alertes");
    expect(m.html).toContain("Home Assistant &lt;silencieux&gt;");
  });

  it("plusieurs alertes : leur nombre en objet", () => {
    expect(alertsEmail([alert("a", "A"), alert("b", "B")], "https://w.test").subject).toBe(
      "WattsUp : 2 alertes",
    );
  });
});

describe("tomorrowEmail (T74)", () => {
  it("titre en objet, détail, lien vers les prévisions et pour arrêter", () => {
    const m = tomorrowEmail(
      {
        title: "Demain, lave-linge de 13 h à 15 h",
        body: "Lave-linge 13 h – 15 h : 90 % solaire.",
      },
      "https://wattsup.test",
    );
    expect(m.subject).toBe("WattsUp : Demain, lave-linge de 13 h à 15 h");
    expect(m.text).toContain("Voir les prévisions : https://wattsup.test/previsions");
    expect(m.text).toContain("https://wattsup.test/reglages?onglet=alertes");
    expect(m.html).toContain("90 % solaire");
  });
});
