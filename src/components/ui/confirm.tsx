"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { button } from "./index";

export interface ConfirmOptions {
  title: string;
  /** Précision sur la conséquence (données conservées, ancien token invalidé…). */
  detail?: string;
  /** Libellé précis du bouton, par défaut « Supprimer ». */
  action?: string;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/** Remplace `window.confirm` : boîte modale de l'application, promesse résolue par le choix. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const ask = useCallback<Ask>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending((previous) => {
          previous?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );

  useEffect(() => {
    const el = dialog.current;
    if (pending && el && !el.open) el.showModal();
  }, [pending]);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    dialog.current?.close();
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="confirm-title"
        aria-describedby={pending?.detail ? "confirm-detail" : undefined}
        onCancel={(e) => {
          e.preventDefault();
          close(false);
        }}
        onClick={(e) => {
          if (e.target === dialog.current) close(false);
        }}
        className="m-auto w-[min(92vw,420px)] overscroll-contain rounded-card border border-border bg-surface p-5 text-ink backdrop:bg-black/40"
      >
        {pending && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h2 id="confirm-title" className="text-[15px] font-semibold text-balance">
                {pending.title}
              </h2>
              {pending.detail && (
                <p id="confirm-detail" className="text-sm text-muted text-pretty">
                  {pending.detail}
                </p>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" autoFocus className={button.secondary} onClick={() => close(false)}>
                Annuler
              </button>
              <button type="button" className={button.primary} onClick={() => close(true)}>
                {pending.action ?? "Supprimer"}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm doit être utilisé dans <ConfirmProvider>");
  return ask;
}
