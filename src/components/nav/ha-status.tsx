"use client";

import { useEffect, useState } from "react";
import { pushState } from "@/domain/ingest/push-state";
import { formatAgo } from "@/lib/format";

interface Props {
  lastPushAt: string | null;
  granularity: "hourly" | "daily";
  /** Heure du rendu serveur : garantit un premier rendu identique côté client. */
  renderedAt: string;
  compact?: boolean;
}

const REFRESH_MS = 60_000;

/**
 * Le layout n'est pas recalculé à la navigation : le dernier push est relu chaque minute
 * (page visible) et au retour sur l'onglet, par une simple requête (pas de Server Action ni
 * de `router.refresh`, qui passent par le routeur et retarderaient la navigation).
 */
export function HaStatus({ lastPushAt, granularity, renderedAt, compact }: Props) {
  const [now, setNow] = useState(() => Date.parse(renderedAt));
  const [pushedAt, setPushedAt] = useState(lastPushAt);
  useEffect(() => {
    const refresh = async () => {
      setNow(Date.now());
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/push-status", { cache: "no-store" });
        if (res.ok) setPushedAt(((await res.json()) as { lastPushAt: string | null }).lastPushAt);
      } catch {
        // hors ligne : l'état précédent reste affiché
      }
    };
    setNow(Date.now());
    const id = setInterval(refresh, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const last = pushedAt ? Date.parse(pushedAt) : null;
  const state = pushState(last, now, granularity);
  // Connecté : plein ; silencieux ou en attente : anneau creux (l'état est aussi écrit).
  const dot = {
    never: "border border-current",
    stale: "border border-current",
    ok: "bg-status-ok",
  }[state];
  const since = last === null ? "" : formatAgo(now - last);

  const text =
    state === "never"
      ? compact
        ? "HA · en attente"
        : "Home Assistant · en attente"
      : compact
        ? `HA · ${since}`
        : `Home Assistant · ${since}`;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1.5 text-xs text-ink-soft">
        <span className={`size-[7px] rounded-full ${dot}`} />
        {text}
      </div>
    );
  }
  // Puce sur le panneau sombre ; l'état (connecté, silencieux, en attente) reste lisible en clair.
  return (
    <div
      className="flex items-center gap-2 rounded-full bg-panel-ink/[0.08] px-3 py-2 text-xs text-panel-soft"
      title={
        state === "stale" ? "Home Assistant silencieux" : state === "never" ? "Aucun envoi reçu" : undefined
      }
    >
      <span className={`size-[7px] flex-none rounded-full ${dot}`} />
      {text}
    </div>
  );
}
