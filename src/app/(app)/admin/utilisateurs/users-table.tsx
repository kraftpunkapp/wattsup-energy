"use client";

import { callAction } from "@/lib/action";
import { useState, useTransition } from "react";
import { Badge, button, Icon } from "@/components/ui";
import type { PushState } from "@/domain/ingest/push-state";
import { formatNumber } from "@/lib/format";
import { deleteUserAction, setUserDisabledAction } from "@/server/actions/admin";

// Liste des comptes de l'instance (administrateur). Désactiver garde les données et se
// réactive ; supprimer est définitif et se confirme sur la ligne. Ni l'un ni l'autre sur un
// compte administrateur.

export interface UserRow {
  id: string;
  name: string;
  email: string;
  createdOn: string;
  disabledOn: string | null;
  isAdmin: boolean;
  self: boolean;
  profiles: string[];
  categories: number;
  values: number;
  /** Dernier envoi Home Assistant : état (même code couleur que le menu), délai, date exacte. */
  lastPush: { state: PushState; ago: string | null; at: string | null };
}

const PUSH_DOT: Record<PushState, string> = {
  never: "bg-subtle",
  stale: "bg-pellet",
  ok: "bg-battery",
};

function Actions({ row }: { row: UserRow }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (row.isAdmin) return <span className="text-xs text-subtle">—</span>;

  const run = (fn: () => ReturnType<typeof deleteUserAction>) =>
    startTransition(async () => {
      const res = await callAction(() => fn());
      setError(res.ok ? null : (res.errors[0] ?? "action impossible"));
      if (res.ok) setConfirming(false);
    });

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-1.5">
          <span className="text-xs whitespace-nowrap text-negative">Tout supprimer ?</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => deleteUserAction(row.id))}
            className={`${button.primary} h-8 bg-negative`}
          >
            Supprimer
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className={`${button.secondary} h-8`}
          >
            Annuler
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => setUserDisabledAction(row.id, !row.disabledOn))}
            className={`${button.secondary} h-8`}
          >
            {row.disabledOn ? "Réactiver" : "Désactiver"}
          </button>
          <button
            type="button"
            aria-label={`Supprimer le compte de ${row.name}`}
            title="Supprimer le compte et toutes ses données"
            onClick={() => setConfirming(true)}
            className={button.iconDanger}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

export function UsersTable({ rows }: { rows: UserRow[] }) {
  const th = "px-4 py-2.5 text-left text-[11px] font-medium whitespace-nowrap text-muted";
  const td = "px-4 py-3 align-top";
  return (
    // relative : le libellé sr-only de la colonne Actions reste dans le cadre qui défile
    // (sinon il élargit la page sur mobile).
    <div className="relative overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[980px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-track">
            <th className={th}>Utilisateur</th>
            <th className={th}>Inscrit le</th>
            <th className={th}>Profils activés</th>
            <th className={`${th} text-right`}>Postes</th>
            <th className={`${th} text-right`}>Valeurs importées</th>
            <th className={th}>Dernier envoi HA</th>
            <th className={th}>Statut</th>
            <th className={`${th} text-right`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={`border-b border-track last:border-b-0 ${r.disabledOn ? "bg-bg/60" : ""}`}
            >
              <td className={td}>
                <p className={`font-medium ${r.disabledOn ? "text-muted" : ""}`}>
                  {r.name}
                  {r.self && <span className="font-normal text-subtle"> (vous)</span>}
                </p>
                <p className="text-xs text-muted">{r.email}</p>
              </td>
              <td className={`${td} tabular-nums`}>{r.createdOn}</td>
              <td className={td}>
                {r.profiles.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {r.profiles.map((p) => (
                      <Badge key={p}>{p}</Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-subtle">Aucun</span>
                )}
              </td>
              <td className={`${td} text-right tabular-nums`}>{formatNumber(r.categories)}</td>
              <td className={`${td} text-right tabular-nums`}>{formatNumber(r.values)}</td>
              <td className={td}>
                <span
                  className="flex items-center gap-1.5 whitespace-nowrap"
                  title={r.lastPush.at ?? "Aucun envoi dans le journal (30 derniers jours)"}
                >
                  <span
                    className={`size-[7px] flex-none rounded-full ${PUSH_DOT[r.lastPush.state]}`}
                  />
                  {r.lastPush.ago ?? <span className="text-subtle">aucun sur 30 j</span>}
                </span>
              </td>
              <td className={td}>
                {r.isAdmin ? (
                  <Badge tone="warning">Administrateur</Badge>
                ) : r.disabledOn ? (
                  <span className="flex flex-col items-start gap-0.5">
                    <Badge>Désactivé</Badge>
                    <span className="text-[11px] text-subtle">depuis le {r.disabledOn}</span>
                  </span>
                ) : (
                  <Badge tone="positive">Actif</Badge>
                )}
              </td>
              <td className={`${td} text-right`}>
                <Actions row={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
