import Image from "next/image";

/**
 * Logo « W-éclair » et logotype. Le logotype est exempté de contraste (WCAG 1.4.3) et lu comme
 * un seul nom : « Up » reste dans l'ambre de la marque (#E0A21B partout), « Energy » en capitales espacées.
 */
export function Logo({ size = 32, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Image src="/wattsup.svg" alt="" width={size} height={size} priority />
      <span className="flex flex-col leading-none">
        <span aria-hidden className="text-[19px] font-semibold tracking-tight">
          Watts<span className="text-solar">Up</span>
        </span>
        <span
          aria-hidden
          className={`mt-1 text-[9px] font-semibold tracking-[0.3em] uppercase ${
            onDark ? "text-panel-muted" : "text-muted"
          }`}
        >
          Energy
        </span>
        <span className="sr-only">WattsUp Energy</span>
      </span>
    </span>
  );
}
