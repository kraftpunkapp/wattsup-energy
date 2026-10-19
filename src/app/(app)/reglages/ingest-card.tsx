"use client";

import { callAction } from "@/lib/action";
import { useState, useTransition } from "react";
import {
  createIngestTokenAction,
  revokeIngestTokenAction,
  setGranularityAction,
} from "@/server/actions/ingest-token";
import type { PushState } from "@/domain/ingest/push-state";
import { Badge, button, Card, CardFooter, Icon, Notice } from "@/components/ui";

interface ActiveToken {
  prefix: string;
  createdAt: string;
}

type Granularity = "hourly" | "daily";

interface Props {
  endpoint: string;
  /** État de la liaison d'après le dernier push accepté (même règle que la navigation). */
  link: PushState;
  /** Dernier push accepté (ISO), null si aucun. */
  lastPushAt: string | null;
  active: ActiveToken | null;
  granularity: Granularity;
}

const MODES: { id: Granularity; label: string; help: string }[] = [
  {
    id: "hourly",
    label: "Horaire",
    help: "HA envoie ses index cumulés chaque heure. Simulation exacte de tous les contrats.",
  },
  {
    id: "daily",
    label: "Quotidien",
    help: "HA envoie une fois par jour les kWh HP et HC de la veille. Les contrats aux plages creuses différentes sont simulés de façon approchée.",
  },
];

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const mono = "font-mono text-xs bg-bg rounded-[8px] px-3 py-2.5";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`${button.secondary} h-auto min-h-9`}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Copié" : "Copier"}
    </button>
  );
}

export function IngestCard({ endpoint, active, granularity, link, lastPushAt }: Props) {
  const [fresh, setFresh] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState(granularity);

  const chooseMode = (next: Granularity) => {
    if (next === mode) return;
    const previous = mode;
    setMode(next);
    startTransition(async () => {
      const res = await callAction(() => setGranularityAction(next));
      if (!res.ok) setMode(previous);
    });
  };

  const generate = () => {
    if (active && !confirm("Régénérer le token ? L'ancien cessera immédiatement de fonctionner."))
      return;
    startTransition(async () => {
      const created = await createIngestTokenAction();
      setFresh(created.token);
    });
  };

  const revoke = () => {
    if (!confirm("Révoquer le token ? Home Assistant ne pourra plus envoyer de données.")) return;
    startTransition(async () => {
      await revokeIngestTokenAction();
      setFresh(null);
    });
  };

  return (
    <Card
      icon="key"
      title="API d'ingestion"
      highlight={Boolean(active) && link === "ok"}
      badges={
        !active ? (
          <Badge>Aucun token</Badge>
        ) : link === "ok" ? (
          <Badge tone="positive">Connecté</Badge>
        ) : link === "stale" ? (
          <Badge tone="warning">Silencieux</Badge>
        ) : (
          <Badge tone="warning">En attente du premier envoi</Badge>
        )
      }
      description="Home Assistant pousse les données. Aucun port entrant à ouvrir."
    >
      {active && !fresh && (
        <p className="text-xs text-muted tabular-nums">
          {lastPushAt
            ? `Dernier envoi reçu le ${fmt(lastPushAt)}.`
            : "Aucun envoi reçu pour l'instant."}
        </p>
      )}

      {!active && !fresh && (
        <Notice
          tone="info"
          title="Aucun token actif."
          action={
            <button type="button" onClick={generate} disabled={pending} className={button.primary}>
              Générer un token
            </button>
          }
        >
          Générez-en un, puis collez-le dans le secrets.yaml de Home Assistant avec l&apos;endpoint
          ci-dessous.
        </Notice>
      )}

      {fresh && (
        <Notice tone="warning" title="Copiez le token maintenant :">
          il ne sera plus jamais affiché. Collez-le dans le secrets.yaml de Home Assistant.
        </Notice>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">Granularité des envois</span>
        <div role="radiogroup" className="flex gap-1 rounded-[10px] bg-chip p-[3px]">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => chooseMode(m.id)}
              className={`flex-1 rounded-[8px] px-3 py-2 text-[13px] font-medium ${
                mode === m.id ? "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : ""
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-subtle">{MODES.find((m) => m.id === mode)?.help}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">Endpoint</span>
        <div className="flex gap-2">
          <div className={`${mono} min-w-0 flex-1 break-all`}>POST {endpoint}</div>
          <CopyButton value={endpoint} />
        </div>
      </div>

      {(fresh || active) && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Token</span>
          {fresh ? (
            <div className="flex gap-2">
              <div className={`${mono} min-w-0 flex-1 break-all`}>{fresh}</div>
              <CopyButton value={fresh} />
            </div>
          ) : (
            active && (
              <>
                <div className={`${mono} truncate`}>{active.prefix}••••••••••••</div>
                <span className="text-[11px] text-subtle">créé le {fmt(active.createdAt)}</span>
              </>
            )
          )}
        </div>
      )}

      {active && (
        <CardFooter>
          <button
            type="button"
            onClick={revoke}
            disabled={pending}
            className="mr-auto text-xs text-negative hover:text-ink disabled:opacity-60"
          >
            Révoquer le token
          </button>
          <button type="button" onClick={generate} disabled={pending} className={button.secondary}>
            Régénérer le token
          </button>
        </CardFooter>
      )}
    </Card>
  );
}
