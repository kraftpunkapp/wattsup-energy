import type { NavId } from "@/domain/profile";

// Tracés repris de la maquette (WattsUpApp.dc.html).
const PATHS: Record<NavId, string> = {
  overview: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
  forecast: "M3 17c3-6 6-9 9-9s5 2 9 6M3 21h18M12 3v2M5.6 5.6 7 7M18.4 5.6 17 7",
  heating: "M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5z",
  roi: "M4 20V11M10 20V5M16 20v-7M2 20h20",
  contracts: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
  settings:
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1",
};

export function NavIcon({ id, size }: { id: NavId; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[id]} />
    </svg>
  );
}
