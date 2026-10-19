"use client";

import { ErrorScreen } from "@/components/error-screen";

// Erreur d'une page de l'appli : le menu reste en place (T60).
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen digest={error.digest} reset={reset} />;
}
