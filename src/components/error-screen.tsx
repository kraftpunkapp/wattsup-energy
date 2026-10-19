"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { button } from "@/components/ui";

// Écran d'erreur (T60) : une page qui n'a pas pu s'afficher, ou une action restée sans
// réponse, ne laisse jamais d'impasse : réessayer sur place, ou revenir à l'accueil.

export function ErrorScreen({ digest, reset }: { digest?: string; reset: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section
      role="alert"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6 text-[13px]"
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold">Un problème est survenu</h1>
        <p className="text-pretty text-ink-soft">
          Cette page n&apos;a pas pu s&apos;afficher, souvent à cause d&apos;une connexion
          interrompue. Réessayez ; si le problème continue, revenez dans quelques minutes.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={button.primary}
          // Une erreur rendue par le serveur se corrige en relisant la page, puis en réaffichant.
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
        >
          Réessayer
        </button>
        <Link href="/" className={`${button.secondary} no-underline`}>
          Retour à la vue d&apos;ensemble
        </Link>
      </div>
      {digest && <p className="text-[11px] text-subtle">Référence : {digest}</p>}
    </section>
  );
}
