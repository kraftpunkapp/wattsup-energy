"use client";

import { useState, useTransition } from "react";
import { button, Icon } from "@/components/ui";
import { refreshMarketAction } from "@/server/actions/admin";

// « Mettre à jour maintenant » : import du catalogue même si la source n'a pas changé.

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function RefreshButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () =>
    startTransition(async () => {
      const res = await refreshMarketAction();
      if (!res.ok)
        return setMessage({ ok: false, text: res.errors[0] ?? "Mise à jour impossible." });
      const r = res.result;
      if (r.status === "error") return setMessage({ ok: false, text: `Échec : ${r.error}` });
      if (r.status === "unchanged") return setMessage({ ok: true, text: "Catalogue déjà à jour." });
      const changes = [
        r.added.length > 0 && plural(r.added.length, "nouvelle", "nouvelles"),
        r.removed.length > 0 && plural(r.removed.length, "retirée", "retirées"),
        r.updated.length > 0 && plural(r.updated.length, "grille modifiée", "grilles modifiées"),
      ].filter(Boolean);
      setMessage({
        ok: true,
        text: `Catalogue importé : ${plural(r.offers, "offre", "offres")}${
          changes.length > 0 ? ` (${changes.join(", ")})` : ""
        }.`,
      });
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={refresh} disabled={pending} className={button.secondary}>
        <Icon name="refresh" size={15} />
        {pending ? "Mise à jour…" : "Mettre à jour maintenant"}
      </button>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`text-xs ${message.ok ? "text-positive" : "text-negative"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
