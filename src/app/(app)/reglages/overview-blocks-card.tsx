"use client";

import { callAction } from "@/lib/action";
import { useOptimistic, useState, useTransition } from "react";
import { Card, SwitchRow } from "@/components/ui";
import { OVERVIEW_BLOCKS, withBlockHidden, type OverviewBlock } from "@/domain/overview-blocks";
import { setOverviewBlockAction } from "@/server/actions/overview-prefs";

// Réglages › Vue d'ensemble (T50) : un interrupteur par bloc optionnel qui s'applique au
// foyer ; enregistré à chaque bascule.

export function OverviewBlocksCard({
  hidden: savedHidden,
  applicable,
}: {
  hidden: OverviewBlock[];
  applicable: OverviewBlock[];
}) {
  const [saved, setSaved] = useState(savedHidden);
  const [hidden, setOptimistic] = useOptimistic(saved);
  const [error, setError] = useState(false);
  const [, startTransition] = useTransition();
  const blocks = OVERVIEW_BLOCKS.filter((b) => applicable.includes(b.id));

  const toggle = (block: OverviewBlock) => {
    const hide = !hidden.includes(block);
    const next = withBlockHidden(hidden, block, hide);
    setError(false);
    startTransition(async () => {
      setOptimistic(next);
      const res = await callAction(() => setOverviewBlockAction(block, hide));
      if (res.ok) setSaved(next);
      else setError(true);
    });
  };

  return (
    <Card
      icon="layout"
      title="Blocs de la Vue d'ensemble"
      description="Les blocs facultatifs qui s'appliquent à votre foyer. Un bloc masqué se réaffiche ici ; il peut aussi être masqué depuis la Vue d'ensemble."
    >
      {blocks.length === 0 ? (
        <p className="text-[13px] text-muted text-pretty">
          Aucun bloc facultatif ne s&apos;applique à votre foyer pour l&apos;instant (ils dépendent
          du solaire, du contrat et des envois horaires).
        </p>
      ) : (
        <div className="flex flex-col">
          {blocks.map((b) => (
            <SwitchRow
              key={b.id}
              label={b.label}
              description={b.description}
              checked={!hidden.includes(b.id)}
              onChange={() => toggle(b.id)}
            />
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-negative">
          Réglage non enregistré. Réessayez.
        </p>
      )}
    </Card>
  );
}
