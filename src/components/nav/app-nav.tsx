"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Icon } from "@/components/ui";
import { useNavigationWake } from "@/components/use-navigation-wake";
import type { NavId, NavItem } from "@/domain/profile";
import { HaStatus } from "./ha-status";
import { NavIcon } from "./icons";
import { AccountMenu } from "./account-menu";
import { MoreMenu } from "./more-menu";
import { VersionLine } from "./version-line";

interface Props {
  items: NavItem[];
  userName: string;
  householdName: string;
  ingest: { lastPushAt: string | null; granularity: "hourly" | "daily"; renderedAt: string };
  /** Version de l'appli, en petit sous le menu du profil. */
  version: string;
  /** Intitulé de l'entrée Contact du menu du profil ; null si l'instance n'envoie pas d'emails. */
  contact: string | null;
  /** Entrées de menu qui portent une alerte en cours (pastille). */
  alertNav: NavId[];
  /** Administrateur de l'instance : section « Administration » (desktop seulement). */
  admin: boolean;
}

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/** Pictogramme d'une entrée de menu, qui pulse tant que sa page charge. */
function PendingIcon({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  useNavigationWake(pending);
  return <span className={`flex ${pending ? "animate-pulse" : ""}`}>{children}</span>;
}

/** Pastille d'alerte sur une entrée de menu (détail dans « À surveiller »). */
function AlertDot({ className }: { className: string }) {
  return (
    <span className={`size-2 flex-none rounded-full ring-2 ring-current ${className}`}>
      <span className="sr-only">(alerte)</span>
    </span>
  );
}

const usersIcon = (
  <svg
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14.5a7 7 0 0 1 4 6.5" />
  </svg>
);

const ADMIN_LINKS: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: "/admin/utilisateurs", label: "Utilisateurs", icon: usersIcon },
  { href: "/admin/offres", label: "Offres du marché", icon: <Icon name="tag" size={18} /> },
  { href: "/admin/parametres", label: "Paramètres", icon: <Icon name="sliders" size={18} /> },
];

/** Section réservée à l'administrateur, sous la navigation : mêmes entrées que les pages du foyer. */
function AdminNav({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Administration" className="mt-6 flex flex-col gap-0.5">
      <p className="wu-label px-3 pb-1.5 !text-panel-muted">Administration</p>
      {ADMIN_LINKS.map((l) => {
        const active = isActive(pathname, l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-medium no-underline hover:bg-panel-active/70 hover:text-panel-ink ${
              active ? "bg-panel-active font-semibold text-panel-ink" : "text-panel-soft"
            }`}
          >
            <PendingIcon>{l.icon}</PendingIcon>
            <span>{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppNav({
  items,
  userName,
  householdName,
  ingest,
  version,
  contact,
  alertNav,
  admin,
}: Props) {
  const actual = usePathname();
  // Entrée touchée : active tout de suite, avant que la nouvelle page n'arrive.
  const [clicked, setClicked] = useState<string | null>(null);
  useEffect(() => setClicked(null), [actual]);
  const pathname = clicked ?? actual;

  return (
    <>
      {/* Desktop : barre latérale sombre (≥ 1024 px) */}
      <aside className="sticky top-0 hidden h-dvh w-[232px] flex-none flex-col border-r border-panel-edge bg-panel px-4 py-6 text-panel-ink lg:flex">
        <div className="px-2 pb-7">
          <Logo onDark />
        </div>
        <nav className="flex flex-col gap-0.5" aria-label="Navigation principale">
          {items.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.id}
                href={n.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setClicked(n.href)}
                className={`flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-medium no-underline hover:bg-panel-active/70 hover:text-panel-ink ${
                  active ? "bg-panel-active font-semibold text-panel-ink" : "text-panel-soft"
                }`}
              >
                <PendingIcon>
                  <NavIcon id={n.id} size={18} />
                </PendingIcon>
                <span>{n.label}</span>
                {alertNav.includes(n.id) && <AlertDot className="ml-auto" />}
              </Link>
            );
          })}
        </nav>
        {admin && <AdminNav pathname={pathname} />}
        <div className="mt-auto">
          <HaStatus {...ingest} />
        </div>
        <div className="pt-4">
          <AccountMenu
            userName={userName}
            householdName={householdName}
            version={version}
            contact={contact}
            variant="sidebar"
          />
          <VersionLine version={version} className="pt-2 text-panel-muted" />
        </div>
      </aside>

      {/* Mobile : en-tête */}
      <header className="flex items-center justify-between bg-bg px-4 pt-4 pb-3 lg:hidden">
        <Logo size={28} />
        <div className="flex items-center gap-2">
          <HaStatus {...ingest} compact />
          <AccountMenu
            userName={userName}
            householdName={householdName}
            version={version}
            contact={contact}
            variant="header"
          />
        </div>
      </header>

      {/* Mobile : barre d'onglets */}
      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface px-2 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))] lg:hidden"
      >
        {items
          .filter((n) => n.mobile !== false)
          .map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.id}
                href={n.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setClicked(n.href)}
                className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-control no-underline ${
                  active ? "bg-track text-ink" : "text-muted"
                }`}
              >
                <span className="relative">
                  <PendingIcon>
                    <NavIcon id={n.id} size={22} />
                  </PendingIcon>
                  {alertNav.includes(n.id) && <AlertDot className="absolute -top-0.5 -right-1" />}
                </span>
                <span className={`text-[11px] ${active ? "font-semibold" : "font-medium"}`}>
                  {n.short}
                </span>
              </Link>
            );
          })}
        <MoreMenu
          items={items.filter((n) => n.mobile === false)}
          pathname={pathname}
          alertNav={alertNav}
        />
      </nav>
    </>
  );
}
