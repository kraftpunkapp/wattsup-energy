"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { button, Icon } from "@/components/ui";
import { settingsHref } from "@/lib/settings-tabs";
import { hideWoodInvitationAction } from "@/server/actions/heating-prefs";

/**
 * Invitation (jamais une carte vide) pour qui ne suit pas le bois : un lien vers le profil,
 * ou « Non, masquer », retenu pour tout le foyer.
 */
export function WoodInvitation() {
  const [hidden, setHidden] = useState(false);
  const [, startTransition] = useTransition();
  if (hidden) return null;
  return (
    <section
      aria-label="Suivre le bois"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-dashed border-dash px-5 py-3"
    >
      <span aria-hidden className="text-muted">
        <Icon name="flame" size={18} />
      </span>
      <p className="flex-1 basis-60 text-sm font-semibold">Vous chauffez aussi au bois ?</p>
      <Link href={settingsHref("profil")} className={`${button.secondary} no-underline`}>
        Suivre le bois
      </Link>
      <button
        type="button"
        className={button.link}
        onClick={() => {
          setHidden(true);
          startTransition(async () => {
            const res = await hideWoodInvitationAction();
            if (!res.ok) setHidden(false);
          });
        }}
      >
        Non, masquer
      </button>
    </section>
  );
}
