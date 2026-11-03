import type { ReactNode } from "react";

/** Bandeau d'information (notice crème), en bas d'écran ou entre deux blocs ; masquable par `actions`. */
export function Banner({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-card bg-note-bg p-4 text-sm text-note-ink sm:flex-row sm:items-center sm:px-5">
      <div className="min-w-0 flex-1 text-pretty">{children}</div>
      {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
    </section>
  );
}
