"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { button } from "@/components/ui";
import type { Alert } from "@/domain/alerts";
import { settingsHref } from "@/lib/settings-tabs";
import { dismissAlertAction } from "@/server/actions/alerts";

// « À surveiller » (T44), en tête de la Vue d'ensemble : 3 alertes au plus d'emblée (les
// plus graves d'abord), chacune avec son action en un clic et « Masquer ». Rien sans alerte.

const SHOWN = 3;

export function AlertsCard({ alerts }: { alerts: Alert[] }) {
  const [, startTransition] = useTransition();
  const [all, setAll] = useState(false);
  const [visible, hide] = useOptimistic(alerts, (list, key: string) =>
    list.filter((a) => a.key !== key),
  );
  if (visible.length === 0) return null;
  const shown = all ? visible : visible.slice(0, SHOWN);

  const dismiss = (a: Alert) =>
    startTransition(async () => {
      hide(a.key);
      await dismissAlertAction(a.key, a.level);
    });

  return (
    <section aria-labelledby="alerts-title" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 id="alerts-title" className="text-xs font-medium tracking-wide text-muted uppercase">
          À surveiller
        </h2>
        <Link href={settingsHref("alertes")} className={button.link}>
          Régler les alertes
        </Link>
      </div>
      <ul className="flex flex-col gap-2">
        {shown.map((a) => (
          <li
            key={a.key}
            className={`flex flex-col gap-3 rounded-card border p-4 text-[13px] text-pretty sm:flex-row sm:items-center ${
              a.level === 2 ? "border-negative/40 bg-danger-bg" : "border-border-strong bg-warning-bg"
            }`}
          >
            <p className="flex-1">
              <span className="font-semibold">{a.title} :</span> {a.text}
            </p>
            <div className="flex flex-none items-center gap-3">
              <Link
                href={a.href}
                className={`${button.secondary} bg-surface text-ink no-underline`}
              >
                {a.action}
              </Link>
              <button
                type="button"
                onClick={() => dismiss(a)}
                aria-label={`Masquer l'alerte « ${a.title} »`}
                title="Masquer : elle revient si la situation s'aggrave, ou dans 7 jours"
                className={button.link}
              >
                Masquer
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!all && visible.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className={`${button.link} self-start px-1`}
        >
          Voir{" "}
          {visible.length - SHOWN === 1 ? "l'autre alerte" : `les ${visible.length - SHOWN} autres`}
        </button>
      )}
    </section>
  );
}
