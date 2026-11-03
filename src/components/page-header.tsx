import type { ReactNode } from "react";

/** Titre de page, sous-titre, et à droite (ou dessous sur mobile) les commandes de l'écran. */
export function PageHeader({
  title,
  subtitle,
  meta,
  children,
}: {
  title: string;
  subtitle: string;
  /** À côté du sous-titre (puce de statut des données). */
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[30px] leading-[1.1] font-bold tracking-[-0.02em] text-balance lg:text-4xl">
          {title}
        </h1>
        {meta ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <p className="text-[15px] text-muted text-pretty">{subtitle}</p>
            {meta}
          </div>
        ) : (
          <p className="text-[15px] text-muted text-pretty">{subtitle}</p>
        )}
      </div>
      {children}
    </header>
  );
}
