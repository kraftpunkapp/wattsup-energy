"use client";

import { callAction } from "@/lib/action";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { Badge, button, Icon, type BadgeTone } from "@/components/ui";
import {
  filterIdeas,
  IDEA_STATUS_LABELS,
  IDEA_STATUSES,
  statusCounts,
  type IdeaStatus,
} from "@/domain/ideas";
import { deleteIdeaAction, setIdeaStatusAction, toggleVoteAction } from "@/server/actions/ideas";
import type { IdeaView } from "@/server/ideas";

// Liste des idées (SPEC §9) : recherche, filtre par statut, vote en un clic (optimiste).
// L'administrateur a, sur chaque idée, un bandeau « Administrateur » en pointillés couleur
// solaire (comme son entrée de menu) : statut, version pour « Terminée », suppression.

export interface IdeaCard extends IdeaView {
  /** Date de proposition, en toutes lettres. */
  createdOn: string;
}

const TONE: Record<IdeaStatus, BadgeTone> = {
  new: "neutral",
  planned: "soft",
  in_progress: "warning",
  done: "positive",
};

const PLURAL: Record<IdeaStatus | "all", string> = {
  all: "Toutes",
  new: "Proposées",
  planned: "Planifiées",
  in_progress: "En cours",
  done: "Terminées",
};

const fieldClass =
  "h-8 rounded-[8px] border border-border-strong bg-surface px-2 text-[13px] text-ink outline-none focus:border-ink";

function VoteButton({ idea, onVote }: { idea: IdeaCard; onVote: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={idea.voted}
      aria-label={
        idea.voted
          ? `Retirer mon vote pour « ${idea.title} » (${idea.votes} votes)`
          : `Voter pour « ${idea.title} » (${idea.votes} votes)`
      }
      title={idea.voted ? "Retirer mon vote" : "Voter pour cette idée"}
      onClick={onVote}
      className={`flex w-12 flex-none flex-col items-center justify-center gap-0.5 self-start rounded-[10px] border py-2 ${
        idea.voted
          ? "border-ink bg-ink text-bg"
          : "border-border-strong text-ink hover:border-ink hover:bg-bg"
      }`}
    >
      <span className="-rotate-90">
        <Icon name="chevron" size={14} />
      </span>
      <span className="text-[15px] font-semibold tabular-nums">{idea.votes}</span>
    </button>
  );
}

/** Bandeau de l'administrateur : statut (version exigée pour « Terminée ») et suppression. */
function AdminBar({ idea, currentVersion }: { idea: IdeaCard; currentVersion: string }) {
  const [status, setStatus] = useState<IdeaStatus>(idea.status);
  const [version, setVersion] = useState(idea.version ?? currentVersion);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = status !== idea.status || (status === "done" && version !== (idea.version ?? ""));

  const run = (fn: () => ReturnType<typeof deleteIdeaAction>) =>
    startTransition(async () => {
      const res = await callAction(() => fn());
      setError(res.ok ? null : (res.errors[0] ?? "action impossible"));
    });

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-solar/60 bg-solar/[0.06] p-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-semibold tracking-[0.08em] text-solar-ink uppercase">
          Administrateur
        </span>
        <span className="text-xs break-words text-muted">
          {idea.author ? `Proposée par ${idea.author}` : "Auteur : compte supprimé"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Statut
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as IdeaStatus);
              setError(null);
            }}
            className={fieldClass}
          >
            {IDEA_STATUSES.map((s) => (
              <option key={s} value={s}>
                {IDEA_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {status === "done" && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            Version
            <input
              value={version}
              onChange={(e) => {
                setVersion(e.target.value);
                setError(null);
              }}
              placeholder="1.2.0"
              spellCheck={false}
              className={`${fieldClass} w-24 tabular-nums`}
            />
          </label>
        )}
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() => run(() => setIdeaStatusAction(idea.id, status, version))}
          className={`${button.secondary} h-8 bg-surface`}
        >
          Enregistrer
        </button>
        <span className="ml-auto flex items-center gap-1.5">
          {confirming ? (
            <>
              <span className="text-xs whitespace-nowrap text-negative">
                Supprimer l&apos;idée ?
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteIdeaAction(idea.id))}
                className={`${button.primary} h-8 bg-negative`}
              >
                Supprimer
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={`${button.secondary} h-8 bg-surface`}
              >
                Annuler
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={`Supprimer l'idée « ${idea.title} »`}
              title="Supprimer l'idée et ses votes"
              onClick={() => setConfirming(true)}
              className={`${button.iconDanger} bg-surface`}
            >
              <Icon name="trash" size={15} />
            </button>
          )}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

export function IdeasBoard({
  ideas,
  isAdmin,
  currentVersion,
}: {
  ideas: IdeaCard[];
  isAdmin: boolean;
  /** Version de l'appli, proposée quand l'administrateur passe une idée à « Terminée ». */
  currentVersion: string;
}) {
  const [status, setStatus] = useState<IdeaStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [voteError, setVoteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [optimistic, toggleOptimistic] = useOptimistic(ideas, (list, id: string) =>
    list.map((i) =>
      i.id === id ? { ...i, voted: !i.voted, votes: i.votes + (i.voted ? -1 : 1) } : i,
    ),
  );

  const counts = useMemo(() => statusCounts(optimistic), [optimistic]);
  // Le tri suit les votes au chargement, pas pendant un clic : la carte ne saute pas sous le doigt.
  const order = useMemo(
    () => new Map(filterIdeas(ideas, "all", "").map((i, n) => [i.id, n])),
    [ideas],
  );
  const shown = filterIdeas(optimistic, status, query).sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );

  const vote = (id: string) =>
    startTransition(async () => {
      toggleOptimistic(id);
      const res = await callAction(() => toggleVoteAction(id));
      setVoteError(res.ok ? null : "Vote non enregistré. Réessayez.");
    });

  return (
    <section aria-labelledby="ideas-title" className="flex flex-col gap-3">
      <h2 id="ideas-title" className="px-1 text-xs font-medium tracking-wide text-muted uppercase">
        Idées proposées
      </h2>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une idée…"
          aria-label="Rechercher une idée"
          className="h-9 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[13px] outline-none focus:border-ink sm:max-w-[260px]"
        />
        <div
          role="radiogroup"
          aria-label="Filtrer par statut"
          className="flex gap-1 overflow-x-auto rounded-[10px] bg-chip p-[3px]"
        >
          {(["all", ...IDEA_STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              onClick={() => setStatus(s)}
              className={`flex flex-none items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[13px] font-medium whitespace-nowrap ${
                status === s ? "bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-ink-soft"
              }`}
            >
              {PLURAL[s]}
              <span className="text-[11px] text-subtle tabular-nums">{counts[s]}</span>
            </button>
          ))}
        </div>
      </div>
      {voteError && (
        <p role="alert" className="text-sm text-negative">
          {voteError}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong p-6 text-center text-[13px] text-muted">
          {ideas.length === 0
            ? "Aucune idée pour l'instant : proposez la première !"
            : "Aucune idée ne correspond à cette recherche."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {shown.map((i) => (
            <li
              key={i.id}
              className="flex gap-3.5 rounded-card border border-border bg-surface p-4 sm:p-5"
            >
              <VoteButton idea={i} onVote={() => vote(i.id)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold break-words">{i.title}</h3>
                  <Badge tone={TONE[i.status]}>
                    {IDEA_STATUS_LABELS[i.status]}
                    {i.status === "done" && i.version ? ` · v${i.version}` : ""}
                  </Badge>
                </div>
                {i.description && (
                  <p className="text-[13px] leading-relaxed break-words whitespace-pre-line text-muted">
                    {i.description}
                  </p>
                )}
                <p className="text-xs text-subtle">Proposée le {i.createdOn}</p>
                {isAdmin && <AdminBar idea={i} currentVersion={currentVersion} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
