"use client";

import { callAction } from "@/lib/action";
import Link from "next/link";
import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { button, Icon } from "@/components/ui";
import type { OverviewBlock } from "@/domain/overview-blocks";
import { settingsHref } from "@/lib/settings-tabs";
import { setOverviewBlockAction } from "@/server/actions/overview-prefs";

// Bloc masquable de la Vue d'ensemble (T50). Le bouton « Masquer » (dans l'en-tête du bloc)
// le remplace aussitôt par un message : où le réafficher (lien direct vers Réglages ›
// Vue d'ensemble), et « Annuler ». Au prochain affichage, le bloc n'est plus là.

const HideContext = createContext<(() => void) | null>(null);

export function Hideable({
  block,
  label,
  children,
}: {
  block: OverviewBlock;
  label: string;
  children: ReactNode;
}) {
  const [hidden, setHidden] = useState(false);
  const [, startTransition] = useTransition();
  const set = (hide: boolean) => {
    setHidden(hide);
    startTransition(async () => {
      const res = await callAction(() => setOverviewBlockAction(block, hide));
      if (!res.ok) setHidden(!hide);
    });
  };

  if (hidden) {
    return (
      <div
        role="status"
        className="flex flex-col gap-2 rounded-card border border-dashed border-dash px-4 py-3 text-[13px] text-muted sm:flex-row sm:items-center"
      >
        <p className="flex-1 text-pretty">
          <span className="font-medium text-ink">« {label} »</span> est masqué. Vous pouvez le
          réafficher à tout moment dans{" "}
          <Link href={settingsHref("vue-ensemble")} className="underline underline-offset-2">
            Réglages › Vue d&apos;ensemble
          </Link>
          .
        </p>
        <button type="button" onClick={() => set(false)} className={`${button.link} self-start`}>
          Annuler
        </button>
      </div>
    );
  }
  return <HideContext.Provider value={() => set(true)}>{children}</HideContext.Provider>;
}

/** Bouton « Masquer ce bloc », à placer dans l'en-tête d'un bloc enveloppé par Hideable. */
export function HideButton({ label }: { label: string }) {
  const hide = useContext(HideContext);
  if (!hide) return null;
  return (
    <button
      type="button"
      onClick={hide}
      aria-label={`Masquer « ${label} »`}
      title="Masquer ce bloc (réactivable dans Réglages)"
      className={button.icon}
    >
      <Icon name="eyeOff" size={15} />
    </button>
  );
}
