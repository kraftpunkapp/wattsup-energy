"use client";

import { callAction } from "@/lib/action";
import { useState, useTransition, type FormEvent } from "react";
import type { CommuneResult } from "@/domain/weather";
import { searchCommunesAction, setLocationAction } from "@/server/actions/location";
import { Badge, button, Card, Icon, Notice } from "@/components/ui";

interface Status {
  location: { label: string; lat: number; lon: number };
  lastDate: string | null;
  days: number;
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
const fmtCoord = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2 });

const inputClass =
  "h-10 min-w-0 flex-1 rounded-[8px] border border-border-strong bg-surface px-3 text-[13px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30";

export function LocationCard({ status }: { status: Status | null }) {
  const [editing, setEditing] = useState(status === null);
  const [results, setResults] = useState<CommuneResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = String(new FormData(e.currentTarget).get("q") ?? "");
    setMessage(null);
    startTransition(async () => setResults(await searchCommunesAction(query)));
  };

  const choose = (commune: CommuneResult) => {
    setMessage("Récupération de l'historique météo…");
    startTransition(async () => {
      const res = await callAction(() => setLocationAction(commune));
      if (!res.ok) return setMessage("Enregistrement impossible. Réessayez.");
      setResults(null);
      setEditing(false);
      setMessage(
        res.weather === "pending"
          ? "Commune enregistrée. La météo sera récupérée lors de la prochaine synchronisation."
          : null,
      );
    });
  };

  return (
    <Card
      icon="pin"
      title="Localisation"
      badges={
        status === null ? (
          <Badge>À renseigner</Badge>
        ) : status.lastDate ? (
          <Badge tone="positive">Météo à jour</Badge>
        ) : (
          <Badge tone="warning">Météo en attente</Badge>
        )
      }
      description={
        <>
          Pour la météo (température, ensoleillement), récupérée chaque jour auprès
          d&apos;Open-Meteo. Seules des coordonnées arrondies à 1 km environ sont transmises.
        </>
      }
      actions={
        status &&
        !editing && (
          <button
            type="button"
            className={button.icon}
            aria-label="Changer de commune"
            title="Changer de commune"
            onClick={() => setEditing(true)}
          >
            <Icon name="edit" />
          </button>
        )
      }
    >
      {status === null && (
        <Notice tone="info" title="Aucune commune.">
          Sans elle, ni la météo ni les degrés-jours du chauffage ne peuvent être calculés.
        </Notice>
      )}

      {status && !editing && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[17px] font-semibold tracking-tight">
              {status.location.label}
            </span>
            <span className="font-mono text-[11px] text-subtle">
              {fmtCoord(status.location.lat)} · {fmtCoord(status.location.lon)}
            </span>
          </div>
          {/* Information de contrôle : une ligne discrète, pas des tuiles. */}
          {status.lastDate && (
            <p className="text-xs text-muted tabular-nums">
              Météo disponible sur {status.days.toLocaleString("fr-FR")} jours, jusqu&apos;au{" "}
              {fmtDate(status.lastDate)}.
            </p>
          )}
        </div>
      )}

      {editing && (
        <>
          <form onSubmit={search} className="flex gap-2">
            <input
              name="q"
              required
              minLength={2}
              placeholder="Votre commune, ex. Nantes"
              className={inputClass}
              autoComplete="address-level2"
            />
            <button type="submit" disabled={pending} className={`${button.primary} h-10`}>
              Chercher
            </button>
          </form>
          {results && results.length === 0 && (
            <p className="text-sm text-muted">Aucune commune trouvée.</p>
          )}
          {results && results.length > 0 && (
            <ul className="flex flex-col">
              {results.map((r) => (
                <li key={`${r.label}-${r.lat}-${r.lon}`}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => choose(r)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 border-t border-track py-2 text-left text-sm hover:bg-bg disabled:opacity-60"
                  >
                    <span>{r.label}</span>
                    <span className="text-[11px] text-subtle">{r.country}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {status && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setResults(null);
              }}
              className={`${button.link} self-start`}
            >
              Annuler
            </button>
          )}
        </>
      )}

      {message && (
        <p role="status" className="text-xs text-pellet">
          {message}
        </p>
      )}
    </Card>
  );
}
