// Pictogrammes d'interface (trait 1,7 px, même style que la navigation).
const PATHS = {
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5 10 17l9-10",
  key: "M14.5 9.5a4 4 0 1 0-1.4 3.1L21 20.5M17 16.5l2-2M15 14.5l1.5-1.5",
  pin: "M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5",
  upload: "M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4",
  download: "M12 4v11M7 10l5 5 5-5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4",
  chevron: "M9 6l6 6-6 6",
  eyeOff:
    "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.6 9.6 0 0 1 12 5c5 0 9 5 9 7 0 1-.9 2.5-2.3 3.9M6.2 6.3C4.2 7.7 3 9.8 3 12c0 2 4 7 9 7 1.6 0 3.1-.5 4.4-1.2",
  layout: "M3 4h18v16H3zM3 10h18M10 10v10",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  tag: "M3 12V3h9l9 9-9 9zM7.5 7.5h.01",
  refresh: "M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  // Postes de consommation (CATEGORY_ICONS, src/domain/categories.ts)
  droplet: "M12 3s-6 6.5-6 11a6 6 0 0 0 12 0c0-4.5-6-11-6-11z",
  flame: "M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5z",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  car: "M5 16V11l2-5h10l2 5v5M3 16h18v3H3zM7 19v2M17 19v2M5 11h14",
  washer: "M5 3h14v18H5zM5 7h14M12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM8 5h.01",
  snowflake: "M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 2 3-2M9 20l3-2 3 2",
  fan: "M12 12c0-4 1-8 4-8s2 5-4 8zM12 12c4 0 8 1 8 4s-5 2-8-4zM12 12c0 4-1 8-4 8s-2-5 4-8zM12 12c-4 0-8-1-8-4s5-2 8 4z",
  waves: "M2 9c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 15c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
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
      <path d={PATHS[name]} />
    </svg>
  );
}
