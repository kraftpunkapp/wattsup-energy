"use client";

import "./globals.css";

// Dernier recours (T60) : la mise en page elle-même n'a pas pu s'afficher. Sans menu ni
// composants, un message et un lien qui recharge l'accueil.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="fr">
      <body>
        <main className="mx-auto flex min-h-dvh max-w-[520px] flex-col justify-center gap-3 px-4 py-12 text-[13px]">
          <h1 className="text-lg font-semibold">WattsUp Energy est momentanément indisponible</h1>
          <p className="text-ink-soft">
            Réessayez dans quelques minutes. Si le problème continue, signalez-le en indiquant
            l&apos;heure.
          </p>
          {/* Lien plein et non <Link> : la mise en page a échoué, on recharge tout. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="font-medium underline underline-offset-2">
            Recharger WattsUp
          </a>
          {error.digest && <p className="text-[11px] text-subtle">Référence : {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
