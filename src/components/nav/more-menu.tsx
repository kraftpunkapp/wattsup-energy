"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NavId, NavItem } from "@/domain/profile";
import { NavIcon } from "./icons";

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/** « Plus » de la barre du bas (mobile) : les pages qui n'y ont pas de place. */
export function MoreMenu({
  items,
  pathname,
  alertNav,
}: {
  items: NavItem[];
  pathname: string;
  alertNav: NavId[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = items.some((n) => isActive(pathname, n.href));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div ref={root} className="relative flex flex-1">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="more-menu"
        onClick={() => setOpen(!open)}
        className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-control ${
          open || current ? "bg-track text-ink" : "text-muted"
        }`}
      >
        <svg
          width={22}
          height={22}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
        >
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
        <span className={`text-[11px] ${current ? "font-semibold" : "font-medium"}`}>Plus</span>
      </button>
      {open && (
        <ul
          id="more-menu"
          className="absolute right-0 bottom-full mb-2 flex w-56 flex-col rounded-control border border-border bg-surface p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
        >
          {items.map((n) => (
            <li key={n.id}>
              <Link
                href={n.href}
                aria-current={isActive(pathname, n.href) ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-[8px] px-3 text-sm no-underline hover:bg-track ${
                  isActive(pathname, n.href) ? "font-semibold text-ink" : "text-ink-soft"
                }`}
              >
                <NavIcon id={n.id} size={18} />
                {n.label}
                {alertNav.includes(n.id) && <span className="ml-auto text-xs">(alerte)</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
