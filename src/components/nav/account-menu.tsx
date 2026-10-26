"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { NavIcon } from "./icons";
import { VersionLine } from "./version-line";

// Menu du profil : le bloc nom (barre latérale) ou l'initiale (mobile) l'ouvrent. « Mon
// compte », « Réglages » (mobile seulement : la barre d'onglets n'a pas de place), « Boîte à idées », l'entrée Contact (si l'instance envoie des emails ; intitulé réglable), puis un trait, puis « Se déconnecter ». Au clavier : focus sur le premier
// élément à l'ouverture, flèches, Début / Fin ; Échap referme et rend le focus au bouton.
// Fermé aussi par un clic à côté ou un changement de page.

const itemClass =
  "flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13px] font-medium text-ink no-underline hover:bg-bg";

function SignOutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

export function AccountMenu({
  userName,
  householdName,
  version,
  contact,
  variant,
}: {
  userName: string;
  householdName: string;
  /** Version de l'appli : en pied du menu sur mobile (la barre latérale l'affiche dessous). */
  version: string;
  /** Intitulé de l'entrée Contact (réglé par l'administrateur) ; null si l'instance n'envoie pas d'emails. */
  contact: string | null;
  /** sidebar : bloc nom en bas de la barre latérale ; header : initiale de l'en-tête mobile. */
  variant: "sidebar" | "header";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const initial = userName.slice(0, 1).toUpperCase();
  const onAccount =
    ["/compte", "/idees", "/contact"].includes(pathname) ||
    (variant === "header" && pathname.startsWith("/reglages"));

  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    // Menu ouvert : le focus va sur « Mon compte » (navigation au clavier, ARIA menu).
    items()[0]?.focus();
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  /** Flèches, Début / Fin entre les éléments ; Échap referme et rend le focus au bouton. */
  const onMenuKey = (e: KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  const signOut = async () => {
    await authClient.signOut();
    router.replace("/connexion");
    router.refresh();
  };

  const trigger =
    variant === "sidebar" ? (
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex w-full min-w-0 items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left text-panel-ink hover:bg-panel-ink/[0.08] ${
          open || onAccount ? "bg-panel-ink/[0.12]" : ""
        }`}
      >
        <span className="flex size-8 flex-none items-center justify-center rounded-full bg-grid text-[13px] font-semibold text-on-grid">
          {initial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-semibold">{userName}</span>
          <span className="truncate text-xs text-panel-muted">{householdName}</span>
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden
        >
          <path d="M7 14l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    ) : (
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Menu du compte (${userName})`}
        onClick={() => setOpen(!open)}
        className={`flex size-9 items-center justify-center rounded-full bg-grid text-[13px] font-semibold text-on-grid ${
          open || onAccount ? "ring-2 ring-ink ring-offset-2 ring-offset-bg" : ""
        }`}
      >
        {initial}
      </button>
    );

  return (
    <div ref={root} className="relative">
      {trigger}
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Compte"
          onKeyDown={onMenuKey}
          className={`absolute z-30 w-60 rounded-control border border-border bg-surface p-1.5 text-ink shadow-[0_8px_24px_rgba(0,0,0,0.14)] ${
            variant === "sidebar" ? "bottom-full left-0 mb-2" : "top-full right-0 mt-2"
          }`}
        >
          <div className="px-3 pt-1.5 pb-2">
            <p className="truncate text-[13px] font-semibold">{userName}</p>
            <p className="truncate text-xs text-muted">{householdName}</p>
          </div>
          <Link href="/compte" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
            <UserIcon />
            Mon compte
          </Link>
          {variant === "header" && (
            <Link
              href="/reglages"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={itemClass}
            >
              <NavIcon id="settings" size={16} />
              Réglages
            </Link>
          )}
          <Link href="/idees" role="menuitem" onClick={() => setOpen(false)} className={itemClass}>
            <Icon name="bulb" size={16} />
            Boîte à idées
          </Link>
          {contact && (
            <Link
              href="/contact"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={itemClass}
            >
              <Icon name="mail" size={16} />
              {contact}
            </Link>
          )}
          <div role="separator" className="my-1.5 border-t border-track" />
          <button type="button" role="menuitem" onClick={signOut} className={itemClass}>
            <SignOutIcon />
            Se déconnecter
          </button>
          {variant === "header" && (
            <VersionLine version={version} className="pt-1 pb-1 text-subtle" />
          )}
        </div>
      )}
    </div>
  );
}
