"use client";

import { callAction } from "@/lib/action";
import { useState, useTransition } from "react";
import { Badge, button, Card } from "@/components/ui";
import type { SignupMode } from "@/domain/signup";
import { saveSignupPolicyAction } from "@/server/actions/admin";

// Mode d'inscription de l'instance (SPEC §9, Administration). Enregistré ici, il remplace
// les variables SIGNUP_MODE et INVITE_CODES de Coolify, qui ne servent plus que de valeur
// de départ.

const MODES: { id: SignupMode; label: string; hint: string }[] = [
  { id: "open", label: "Ouvertes", hint: "Tout le monde peut créer un compte." },
  {
    id: "invite",
    label: "Sur invitation",
    hint: "Un code d'invitation est demandé à l'inscription.",
  },
  {
    id: "closed",
    label: "Fermées",
    hint: "Aucun nouveau compte ; le lien « Créer un compte » disparaît de la connexion.",
  },
];

const inputClass =
  "h-10 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[14px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30";

export function SignupCard({
  mode: savedMode,
  codes: savedCodes,
  source,
}: {
  mode: SignupMode;
  codes: string[];
  /** env : aucun réglage enregistré, les variables d'environnement s'appliquent. */
  source: "admin" | "env";
}) {
  const [mode, setMode] = useState(savedMode);
  const [codes, setCodes] = useState(savedCodes.join(", "));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const current = MODES.find((m) => m.id === savedMode);
  const dirty = mode !== savedMode || codes !== savedCodes.join(", ") || source === "env";

  const save = () =>
    startTransition(async () => {
      const res = await callAction(() => saveSignupPolicyAction(mode, codes));
      setMessage(
        res.ok
          ? { ok: true, text: "Réglage enregistré : il s'applique dès maintenant." }
          : { ok: false, text: res.errors[0] ?? "Enregistrement impossible." },
      );
    });

  return (
    <Card
      icon="key"
      title="Inscriptions"
      badges={<Badge tone={savedMode === "closed" ? "neutral" : "soft"}>{current?.label}</Badge>}
      description={
        source === "env"
          ? "Valeur actuelle reprise de la variable SIGNUP_MODE de l'instance. Enregistrée ici, elle la remplace."
          : "Qui peut créer un compte sur cette instance. Ce réglage remplace SIGNUP_MODE et INVITE_CODES."
      }
    >
      <div className="flex flex-col gap-2">
        <div
          role="radiogroup"
          aria-label="Mode d'inscription"
          className="flex w-fit gap-1 rounded-[10px] bg-chip p-[3px]"
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => {
                setMode(m.id);
                setMessage(null);
              }}
              className={`rounded-[8px] px-3 py-1.5 text-[13px] font-medium whitespace-nowrap ${
                mode === m.id ? "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-soft"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{MODES.find((m) => m.id === mode)?.hint}</p>
      </div>
      {mode === "invite" && (
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Codes d&apos;invitation
          <input
            value={codes}
            onChange={(e) => {
              setCodes(e.target.value);
              setMessage(null);
            }}
            spellCheck={false}
            autoComplete="off"
            placeholder="ex. voisins-2026"
            className={`${inputClass} text-ink`}
          />
          <span className="text-subtle">
            À communiquer aux personnes invitées. Plusieurs codes : séparez-les par des virgules.
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={save}
          className={button.primary}
        >
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
