"use client";

import { ErrorScreen } from "@/components/error-screen";

// Erreur hors de l'appli (connexion, inscription) ou de son menu (T60).
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-full max-w-[520px] items-center px-4 py-12">
      <ErrorScreen digest={error.digest} reset={reset} />
    </main>
  );
}
