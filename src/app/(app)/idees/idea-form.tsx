"use client";

import { callAction } from "@/lib/action";
import { useState, useTransition, type FormEvent } from "react";
import { button, Card } from "@/components/ui";
import { IDEA_DESCRIPTION_MAX, IDEA_TITLE_MAX } from "@/domain/ideas";
import { proposeIdeaAction } from "@/server/actions/ideas";

const inputClass =
  "w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[14px] text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30";

/** Compteur de caractères sous un champ, en rouge à l'approche de la limite. */
function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span
      className={`text-[11px] tabular-nums ${value.length > max * 0.9 ? "text-negative" : "text-subtle"}`}
    >
      {value.length} / {max}
    </span>
  );
}

export function IdeaForm() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await callAction(() => proposeIdeaAction({ title, description }));
      if (!res.ok) {
        setMessage({ ok: false, text: res.errors.join(" ") });
        return;
      }
      setTitle("");
      setDescription("");
      setMessage({ ok: true, text: "Merci ! Votre idée est dans la liste ci-dessous." });
    });
  };

  return (
    <Card
      icon="bulb"
      title="Proposer une idée"
      description="Une fonction qui manque, un écran à améliorer : décrivez ce qui vous aiderait."
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          <span className="flex justify-between">
            Titre
            <Counter value={title} max={IDEA_TITLE_MAX} />
          </span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setMessage(null);
            }}
            required
            maxLength={IDEA_TITLE_MAX}
            autoComplete="off"
            placeholder="ex. Alerte quand le stock de granulés est bas"
            className={`${inputClass} h-10`}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          <span className="flex justify-between">
            Description (facultative)
            <Counter value={description} max={IDEA_DESCRIPTION_MAX} />
          </span>
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setMessage(null);
            }}
            maxLength={IDEA_DESCRIPTION_MAX}
            rows={4}
            className={`${inputClass} resize-y py-2 leading-relaxed`}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending || !title.trim()} className={button.primary}>
            Proposer l&apos;idée
          </button>
          {message && (
            <p
              role="status"
              className={`text-sm ${message.ok ? "text-positive" : "text-negative"}`}
            >
              {message.text}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
