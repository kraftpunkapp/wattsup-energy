"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { button, Notice } from "@/components/ui";
import { callAction } from "@/lib/action";
import { hideOffPeakNoticeAction } from "@/server/actions/off-peak-notice";

/**
 * Réforme des heures creuses (T80) : invite à vérifier ses horaires. Sans `onEdit`, l'action
 * mène à la page Contrats, saisie ouverte.
 */
export function OffPeakNotice({ onEdit }: { onEdit?: () => void }) {
  const [hidden, setHidden] = useState(false);
  const [, startTransition] = useTransition();
  if (hidden) return null;
  const update = "Mettre à jour mes horaires";
  return (
    <Notice
      tone="info"
      icon="bolt"
      title="Vos heures creuses changent peut-être."
      action={
        <>
          {onEdit ? (
            <button type="button" className={button.secondary} onClick={onEdit}>
              {update}
            </button>
          ) : (
            <Link href="/contrats?horaires=1" className={`${button.secondary} no-underline`}>
              {update}
            </Link>
          )}
          <button
            type="button"
            className={button.link}
            onClick={() => {
              setHidden(true);
              startTransition(async () => {
                const res = await callAction(() => hideOffPeakNoticeAction());
                if (!res.ok) setHidden(false);
              });
            }}
          >
            Masquer
          </button>
        </>
      }
    >
      Les heures creuses changent pour de nombreux foyers à partir du 1er décembre 2026. Vérifiez
      vos horaires sur votre facture ou votre espace client.
    </Notice>
  );
}
