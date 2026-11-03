"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { button, Icon } from "@/components/ui";
import { settingsHref } from "@/lib/settings-tabs";

const KEY = "wattsup:wood-invitation-hidden";

/**
 * Invitation (jamais une carte vide) pour qui ne suit pas le bois : un lien vers le profil,
 * ou « Non, masquer » (mémorisé sur cet appareil).
 */
export function WoodInvitation() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);
  if (hidden) return null;
  return (
    <section
      aria-label="Suivre le bois"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-dashed border-dash px-5 py-3"
    >
      <span aria-hidden className="text-muted">
        <Icon name="flame" size={18} />
      </span>
      <p className="flex-1 basis-60 text-[15px] font-semibold">Vous chauffez aussi au bois ?</p>
      <Link href={settingsHref("profil")} className={`${button.secondary} no-underline`}>
        Suivre le bois
      </Link>
      <button
        type="button"
        className={button.link}
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            // choix non mémorisé
          }
          setHidden(true);
        }}
      >
        Non, masquer
      </button>
    </section>
  );
}
