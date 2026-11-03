"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

// Mot de passe oublié : demande du lien par email, puis choix du nouveau mot de passe.

const inputClass =
  "h-11 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-sm outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-accent/30";
const card = "flex flex-col gap-4 rounded-card border border-border bg-surface p-6";
const submit = "h-11 rounded-[8px] bg-ink text-sm font-medium text-bg disabled:opacity-60";

const BackToSignIn = () => (
  <p className="text-sm text-muted">
    <Link href="/connexion" className="underline underline-offset-2">
      Retour à la connexion
    </Link>
  </p>
);

/** Demande du lien : même réponse que l'adresse existe ou non (rien n'est révélé). */
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const email = String(new FormData(e.currentTarget).get("email"));
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/nouveau-mot-de-passe",
    });
    setPending(false);
    if (error && error.status === 429) {
      setError("Trop de demandes : réessayez dans une minute.");
      return;
    }
    if (error) {
      setError("Envoi impossible pour le moment. Réessayez plus tard.");
      return;
    }
    setSent(true);
  }

  return (
    <form onSubmit={onSubmit} className={card}>
      <h1 className="text-2xl font-semibold tracking-tight">Mot de passe oublié</h1>
      {sent ? (
        <p role="status" className="text-sm text-pretty">
          Si un compte existe pour cette adresse, un email vient de partir avec un lien pour choisir
          un nouveau mot de passe. Il est valable une heure ; pensez à regarder dans les
          indésirables.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted text-pretty">
            Indiquez l&apos;adresse de votre compte : vous recevrez un lien pour choisir un nouveau
            mot de passe.
          </p>
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
          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
          <button type="submit" disabled={pending} className={submit}>
            {pending ? "Envoi…" : "Recevoir le lien"}
          </button>
        </>
      )}
      <BackToSignIn />
    </form>
  );
}

/** Nouveau mot de passe, depuis le lien de l'email (jeton dans l'URL). */
export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const invalid = params.get("error") === "INVALID_TOKEN" || !token;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError("Les deux mots de passe ne sont pas identiques.");
      return;
    }
    setError(null);
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token: token ?? "" });
    setPending(false);
    if (error) {
      setError(
        error.code === "PASSWORD_TOO_SHORT"
          ? "Le mot de passe doit faire au moins 10 caractères."
          : "Lien expiré ou déjà utilisé : demandez-en un nouveau.",
      );
      return;
    }
    router.replace("/connexion?reinitialise=1");
  }

  if (invalid) {
    return (
      <div className={card}>
        <h1 className="text-2xl font-semibold tracking-tight">Lien expiré</h1>
        <p className="text-sm text-muted text-pretty">
          Ce lien n&apos;est plus valable (il dure une heure et ne sert qu&apos;une fois).
        </p>
        <Link href="/mot-de-passe-oublie" className={`${submit} flex items-center justify-center`}>
          Demander un nouveau lien
        </Link>
        <BackToSignIn />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={card}>
      <h1 className="text-2xl font-semibold tracking-tight">Nouveau mot de passe</h1>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">Nouveau mot de passe (10 caractères au moins)</span>
        <input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">Confirmez-le</span>
        <input
          name="confirm"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={submit}>
        {pending ? "Enregistrement…" : "Changer le mot de passe"}
      </button>
      <BackToSignIn />
    </form>
  );
}
