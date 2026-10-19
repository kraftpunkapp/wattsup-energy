"use client";

import { callAction } from "@/lib/action";
import { useState, useTransition, type FormEvent } from "react";
import { button, Card } from "@/components/ui";
import {
  CONTACT_KIND_LABELS,
  CONTACT_KINDS,
  CONTACT_MESSAGE_MAX,
  type ContactKind,
} from "@/domain/contact";
import { sendContactAction } from "@/server/actions/contact";

const fieldClass =
  "w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30";

const PLACEHOLDER: Record<ContactKind, string> = {
  contact: "Votre question ou votre remarque…",
  bug: "Ce que vous faisiez, ce qui s'est passé, ce que vous attendiez…",
};

/** Motif et message ; l'expéditeur est le compte connecté (nom et adresse connus). */
export function ContactForm({
  name,
  email,
  title,
}: {
  name: string;
  email: string;
  /** Titre de la carte : intitulé réglé par l'administrateur, sinon « Écrire à l'administrateur ». */
  title: string;
}) {
  const [kind, setKind] = useState<ContactKind>("contact");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await callAction(() => sendContactAction({ kind, message }));
      if (!res.ok) {
        setStatus({ ok: false, text: res.errors.join(" ") });
        return;
      }
      setMessage("");
      setStatus({
        ok: true,
        text: `Message envoyé. La réponse arrivera à ${email}.`,
      });
    });
  };

  return (
    <Card
      icon="mail"
      title={title}
      description={
        <>
          Envoyé au nom de <span className="font-medium text-ink">{name}</span> ({email}) : la
          réponse arrivera à cette adresse.
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Motif
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ContactKind);
              setStatus(null);
            }}
            className={`${fieldClass} h-10 sm:max-w-[260px]`}
          >
            {CONTACT_KINDS.map((k) => (
              <option key={k} value={k}>
                {CONTACT_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          <span className="flex justify-between">
            Message
            <span
              className={`text-[11px] tabular-nums ${
                message.length > CONTACT_MESSAGE_MAX * 0.9 ? "text-negative" : "text-subtle"
              }`}
            >
              {message.length} / {CONTACT_MESSAGE_MAX}
            </span>
          </span>
          <textarea
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setStatus(null);
            }}
            required
            maxLength={CONTACT_MESSAGE_MAX}
            rows={7}
            placeholder={PLACEHOLDER[kind]}
            className={`${fieldClass} resize-y py-2 leading-relaxed`}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending || !message.trim()} className={button.primary}>
            {pending ? "Envoi…" : "Envoyer"}
          </button>
          {status && (
            <p role="status" className={`text-sm ${status.ok ? "text-positive" : "text-negative"}`}>
              {status.text}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
