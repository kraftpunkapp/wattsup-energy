// Emails envoyés par l'instance (SPEC §14) : contenu, texte et HTML. Pur.

import type { Alert } from "./alerts";
import { CONTACT_KIND_LABELS, type ContactKind } from "./contact";

export interface MailContent {
  subject: string;
  text: string;
  html: string;
  /** Adresse de réponse (message de contact : l'expéditeur). */
  replyTo?: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Lien de réinitialisation du mot de passe (valable une heure). */
export function resetPasswordEmail(name: string, url: string): MailContent {
  const hello = name ? `Bonjour ${name},` : "Bonjour,";
  const text = [
    hello,
    "",
    "Vous avez demandé à changer le mot de passe de votre compte WattsUp Energy.",
    "Ouvrez ce lien pour en choisir un nouveau (il est valable une heure) :",
    url,
    "",
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.",
  ].join("\n");
  const html = `<!doctype html><html lang="fr"><body style="font-family:system-ui,sans-serif;color:#16181a;background:#f4f2ec;padding:24px">
<div style="max-width:480px;margin:auto;background:#fff;border:1px solid #e4e0d6;border-radius:14px;padding:24px">
<p>${escapeHtml(hello)}</p>
<p>Vous avez demandé à changer le mot de passe de votre compte WattsUp Energy.</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#16181a;color:#f4f2ec;padding:10px 16px;border-radius:8px;text-decoration:none">Choisir un nouveau mot de passe</a></p>
<p style="font-size:13px;color:#6b6f68">Le lien est valable une heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe reste inchangé.</p>
</div></body></html>`;
  return { subject: "WattsUp Energy : nouveau mot de passe", text, html };
}

/** Cadre commun des emails : carte blanche sur le fond de l'appli. */
const layout = (body: string) =>
  `<!doctype html><html lang="fr"><body style="font-family:system-ui,sans-serif;color:#16181a;background:#f4f2ec;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border:1px solid #e4e0d6;border-radius:14px;padding:24px">
${body}
</div></body></html>`;

const paragraphs = (s: string) =>
  s
    .split(/\n{2,}/)
    .map((p) => `<p style="white-space:pre-wrap">${escapeHtml(p)}</p>`)
    .join("\n");

/**
 * Confirmation d'une adresse (changement d'email, T52) : envoyée à la nouvelle adresse, qui
 * ne remplace l'ancienne qu'une fois le lien ouvert (valable une heure).
 */
export function confirmEmailEmail(name: string, url: string): MailContent {
  const hello = name ? `Bonjour ${name},` : "Bonjour,";
  const text = [
    hello,
    "",
    "Pour utiliser cette adresse avec votre compte WattsUp Energy, ouvrez ce lien (il est valable une heure) :",
    url,
    "",
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : rien ne change.",
  ].join("\n");
  const html = layout(`<p>${escapeHtml(hello)}</p>
<p>Pour utiliser cette adresse avec votre compte WattsUp Energy, confirmez-la :</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#16181a;color:#f4f2ec;padding:10px 16px;border-radius:8px;text-decoration:none">Confirmer cette adresse</a></p>
<p style="font-size:13px;color:#6b6f68">Le lien est valable une heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : rien ne change.</p>`);
  return { subject: "WattsUp Energy : confirmez votre adresse email", text, html };
}

/** Nouvelle idée dans la boîte à idées : envoyée à l'administrateur. */
export function newIdeaEmail(idea: {
  title: string;
  description: string;
  authorName: string;
  authorEmail: string;
  url: string;
}): MailContent {
  const by = `${idea.authorName} <${idea.authorEmail}>`;
  const text = [
    `Nouvelle idée proposée par ${by} :`,
    "",
    idea.title,
    ...(idea.description ? ["", idea.description] : []),
    "",
    `Boîte à idées : ${idea.url}`,
  ].join("\n");
  const html =
    layout(`<p style="font-size:13px;color:#6b6f68">Nouvelle idée proposée par ${escapeHtml(by)}</p>
<h2 style="font-size:17px;margin:8px 0">${escapeHtml(idea.title)}</h2>
${idea.description ? paragraphs(idea.description) : ""}
<p><a href="${escapeHtml(idea.url)}" style="display:inline-block;background:#16181a;color:#f4f2ec;padding:10px 16px;border-radius:8px;text-decoration:none">Ouvrir la boîte à idées</a></p>`);
  return { subject: `Nouvelle idée : ${idea.title}`, text, html };
}

/** Message du formulaire de contact : envoyé à l'administrateur, réponse directe à l'expéditeur. */
export function contactEmail(m: {
  kind: ContactKind;
  message: string;
  name: string;
  email: string;
  /** Version de l'appli (utile pour un bug). */
  version: string;
}): MailContent {
  const label = CONTACT_KIND_LABELS[m.kind];
  const by = `${m.name} <${m.email}>`;
  const firstLine = m.message.split("\n")[0] ?? "";
  const excerpt = firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine;
  const text = [
    `${label} — ${by}, WattsUp ${m.version}`,
    "",
    m.message,
    "",
    "Répondez à cet email pour écrire directement à l'expéditeur.",
  ].join("\n");
  const html =
    layout(`<p style="font-size:13px;color:#6b6f68">${escapeHtml(label)} — ${escapeHtml(by)}, WattsUp ${escapeHtml(m.version)}</p>
${paragraphs(m.message)}
<p style="font-size:13px;color:#6b6f68">Répondez à cet email pour écrire directement à l'expéditeur.</p>`);
  return {
    subject: `[${m.kind === "bug" ? "Bug" : "Contact"}] ${excerpt}`,
    text,
    html,
    replyTo: m.email,
  };
}

/**
 * Alertes nouvelles ou aggravées (T44), pour qui a coché « par email » dans Réglages ›
 * Alertes. Liens absolus vers l'instance (`origin`).
 */
export function alertsEmail(alerts: readonly Alert[], origin: string): MailContent {
  const settings = `${origin}/reglages?onglet=alertes`;
  const subject =
    alerts.length === 1 ? `WattsUp : ${alerts[0]?.title}` : `WattsUp : ${alerts.length} alertes`;
  const text = [
    ...alerts.flatMap((a) => [`${a.title}`, a.text, `${a.action} : ${origin}${a.href}`, ""]),
    `Vous recevez cet email parce que vous l'avez demandé. Pour l'arrêter : ${settings}`,
  ].join("\n");
  const html = layout(`${alerts
    .map(
      (a) => `<h2 style="font-size:16px;margin:16px 0 4px">${escapeHtml(a.title)}</h2>
<p style="margin:0 0 8px">${escapeHtml(a.text)}</p>
<p style="margin:0 0 12px"><a href="${escapeHtml(origin + a.href)}" style="color:#3d5a80">${escapeHtml(a.action)}</a></p>`,
    )
    .join("\n")}
<p style="font-size:12px;color:#6b6f68;border-top:1px solid #e4e0d6;padding-top:12px">Vous recevez cet email parce que vous l'avez demandé. <a href="${escapeHtml(settings)}" style="color:#6b6f68">Régler les alertes</a></p>`);
  return { subject, text, html };
}

/** « Créneaux de demain » (T74) : le titre en objet, le détail, le lien vers les prévisions. */
export function tomorrowEmail(
  notice: { title: string; body: string },
  origin: string,
): MailContent {
  const page = `${origin}/previsions`;
  const settings = `${origin}/reglages?onglet=alertes`;
  const subject = `WattsUp : ${notice.title}`;
  const text = [
    notice.body,
    `Voir les prévisions : ${page}`,
    "",
    `Vous recevez cet email parce que vous l'avez demandé. Pour l'arrêter : ${settings}`,
  ].join("\n");
  const html = layout(`<h2 style="font-size:16px;margin:16px 0 4px">${escapeHtml(notice.title)}</h2>
<p style="margin:0 0 8px">${escapeHtml(notice.body)}</p>
<p style="margin:0 0 12px"><a href="${escapeHtml(page)}" style="color:#3d5a80">Voir les prévisions</a></p>
<p style="font-size:12px;color:#6b6f68;border-top:1px solid #e4e0d6;padding-top:12px">Vous recevez cet email parce que vous l'avez demandé. <a href="${escapeHtml(settings)}" style="color:#6b6f68">Régler les notifications</a></p>`);
  return { subject, text, html };
}
