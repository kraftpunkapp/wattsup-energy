"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useHydrated } from "./use-hydrated";
import { safeNextPath } from "@/domain/redirect";
import { authClient } from "@/lib/auth-client";

type Mode = "connexion" | "inscription";

const COPY: Record<
  Mode,
  {
    title: string;
    submit: string;
    /** Libellé pendant l'envoi. */
    pending: string;
    switchText: string;
    switchHref: string;
    switchLabel: string;
  }
> = {
  connexion: {
    title: "Connexion",
    submit: "Se connecter",
    pending: "Connexion…",
    switchText: "Pas encore de compte ?",
    switchHref: "/inscription",
    switchLabel: "Créer un compte",
  },
  inscription: {
    title: "Créer un compte",
    submit: "Créer mon compte",
    pending: "Création du compte…",
    switchText: "Déjà inscrit ?",
    switchHref: "/connexion",
    switchLabel: "Se connecter",
  },
};

// Messages d'erreur Better Auth traduits ; les autres retombent sur un message générique.
const ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email ou mot de passe incorrect.",
  USER_ALREADY_EXISTS: "Un compte existe déjà avec cet email.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Un compte existe déjà avec cet email.",
  PASSWORD_TOO_SHORT: "Le mot de passe doit faire au moins 10 caractères.",
  INVALID_EMAIL: "Adresse email invalide.",
};

const inputClass =
  "h-11 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-sm outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/30";

export function AuthForm({
  mode,
  inviteRequired = false,
  signupOpen = true,
  passwordReset = false,
}: {
  mode: Mode;
  /** Inscription sur invitation (SIGNUP_MODE=invite) : un code est demandé. */
  inviteRequired?: boolean;
  /** Lien « Créer un compte » masqué si les inscriptions sont fermées. */
  signupOpen?: boolean;
  /** Lien « Mot de passe oublié ? » (si l'envoi d'emails est configuré). */
  passwordReset?: boolean;
}) {
  const copy = COPY[mode];
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("suite"));
  const reset = mode === "connexion" && params.get("reinitialise") === "1";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const { error } =
      mode === "inscription"
        ? await authClient.signUp.email(
            { email, password, name: String(form.get("name")) },
            inviteRequired
              ? { headers: { "x-invite-code": String(form.get("invite") ?? "") } }
              : undefined,
          )
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (error) {
      // Refus de SIGNUP_MODE : le message du serveur est déjà en français.
      setError(
        ERRORS[error.code ?? ""] ??
          (error.status === 403 && error.message
            ? error.message
            : "Une erreur est survenue. Réessayez."),
      );
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6"
    >
      <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
      {reset && (
        <p role="status" className="text-sm text-positive">
          Mot de passe changé : connectez-vous avec le nouveau.
        </p>
      )}
      {mode === "inscription" && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Prénom</span>
          <input name="name" required autoComplete="given-name" className={inputClass} />
        </label>
      )}
      {mode === "inscription" && inviteRequired && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted">Code d&apos;invitation</span>
          <input name="invite" required autoComplete="off" className={inputClass} />
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          spellCheck={false}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-muted">Mot de passe</span>
          {mode === "connexion" && passwordReset && (
            <Link href="/mot-de-passe-oublie" className="text-xs underline underline-offset-2">
              Mot de passe oublié ?
            </Link>
          )}
        </span>
        <input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete={mode === "inscription" ? "new-password" : "current-password"}
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !hydrated}
        className="h-11 rounded-[8px] bg-ink text-sm font-medium text-bg disabled:opacity-60"
      >
        {pending ? copy.pending : copy.submit}
      </button>
      {(mode === "inscription" || signupOpen) && (
        <p className="text-sm text-muted">
          {copy.switchText}{" "}
          <Link href={copy.switchHref} className="underline underline-offset-2">
            {copy.switchLabel}
          </Link>
        </p>
      )}
    </form>
  );
}
