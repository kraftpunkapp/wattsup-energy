"use client";

import { callAction } from "@/lib/action";
import { useState, useTransition } from "react";
import { button, Card, Notice } from "@/components/ui";
import { RichText } from "@/components/rich-text";
import {
  CONTACT_INTRO_MAX,
  CONTACT_LABEL_MAX,
  CONTACT_NOTICE_MAX,
  DEFAULT_CONTACT_INTRO,
  DEFAULT_CONTACT_LABEL,
  DEFAULT_FORM_TITLE,
} from "@/domain/instance-texts";
import { saveContactTextsAction } from "@/server/actions/admin";

// Page Contact de l'instance (T53) : intitulé de l'entrée du menu (titre de la page et du
// formulaire), phrase d'introduction et texte affiché sous le bouton de soutien
// (hébergement, confidentialité…). Vides : textes neutres.

const inputClass =
  "w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30";

export function ContactTextsCard({
  label: savedLabel,
  intro: savedIntro,
  notice: savedNotice,
  mailOn,
}: {
  label: string;
  intro: string;
  notice: string;
  /** Sans envoi d'emails, l'entrée Contact n'apparaît pas : le réglage reste possible. */
  mailOn: boolean;
}) {
  const [label, setLabel] = useState(savedLabel === DEFAULT_CONTACT_LABEL ? "" : savedLabel);
  const [intro, setIntro] = useState(savedIntro === DEFAULT_CONTACT_INTRO ? "" : savedIntro);
  const [notice, setNotice] = useState(savedNotice);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const res = await callAction(() => saveContactTextsAction({ label, intro, notice }));
      setMessage(
        res.ok
          ? { ok: true, text: "Enregistré : visible dès maintenant dans le menu et sur la page." }
          : { ok: false, text: res.errors[0] ?? "Enregistrement impossible." },
      );
    });

  return (
    <Card
      icon="mail"
      title="Page Contact"
      description="Intitulé de l'entrée du menu du profil, phrase d'introduction et texte affiché sous le bouton de soutien, par exemple l'hébergement et la confidentialité des données de cette instance."
    >
      {!mailOn && (
        <Notice tone="info" title="Messagerie non configurée :">
          l&apos;entrée Contact n&apos;apparaît pas tant que l&apos;instance n&apos;envoie pas
          d&apos;emails (MAIL_FROM et BREVO_API_KEY ou RESEND_API_KEY).
        </Notice>
      )}
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Intitulé dans le menu
        <input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setMessage(null);
          }}
          maxLength={CONTACT_LABEL_MAX}
          placeholder={DEFAULT_CONTACT_LABEL}
          autoComplete="off"
          className={`${inputClass} h-10`}
        />
        <span className="text-subtle">
          Aussi titre de la page Contact et du formulaire (vide : « {DEFAULT_FORM_TITLE} »).
        </span>
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Phrase d&apos;introduction
        <input
          value={intro}
          onChange={(e) => {
            setIntro(e.target.value);
            setMessage(null);
          }}
          maxLength={CONTACT_INTRO_MAX}
          placeholder={DEFAULT_CONTACT_INTRO}
          autoComplete="off"
          className={`${inputClass} h-10`}
        />
        <span className="text-subtle">Sous le titre de la page Contact.</span>
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Texte sous le bouton de soutien (facultatif)
        <textarea
          value={notice}
          onChange={(e) => {
            setNotice(e.target.value);
            setMessage(null);
          }}
          maxLength={CONTACT_NOTICE_MAX}
          rows={10}
          className={`${inputClass} resize-y py-2 leading-relaxed`}
        />
        <span className="text-subtle">
          Mise en forme : **gras**, une ligne commençant par « * » pour une puce, une ligne vide
          entre deux paragraphes.
        </span>
      </label>
      {notice.trim() && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-border-strong p-4">
          <p className="text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
            Aperçu
          </p>
          <RichText text={notice} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} onClick={save} className={button.primary}>
          Enregistrer
        </button>
        {message && (
          <p role="status" className={`text-sm ${message.ok ? "text-positive" : "text-negative"}`}>
            {message.text}
          </p>
        )}
      </div>
    </Card>
  );
}
