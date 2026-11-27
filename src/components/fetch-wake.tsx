"use client";

import { useEffect, useState } from "react";
import { useNavigationWake } from "./use-navigation-wake";

// Même défaut de React que pour la navigation (voir useNavigationWake) après une Server
// Action : la réponse arrive, mais l'écran garde l'ancien état jusqu'au rendu suivant (jusqu'à
// 60 s). Quelques petits rendus après chaque requête de la page suffisent, quel que soit le
// formulaire à l'origine de l'appel.

const AWAKE_MS = 3_000;

export function FetchWake() {
  const [awake, setAwake] = useState(false);
  useNavigationWake(awake);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new PerformanceObserver((list) => {
      const fetched = list
        .getEntries()
        .some((e) => (e as PerformanceResourceTiming).initiatorType === "fetch");
      if (!fetched) return;
      setAwake(true);
      clearTimeout(timer);
      timer = setTimeout(() => setAwake(false), AWAKE_MS);
    });
    observer.observe({ type: "resource" });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);
  return null;
}
