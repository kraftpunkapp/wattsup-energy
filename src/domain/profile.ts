// Visibilité des modules selon le profil énergétique (SPEC §7.6). Seule source de
// vérité : la nav, les pages et les composants interrogent cette fonction plutôt que
// de tester le profil eux-mêmes.

export interface EnergyProfile {
  solar: boolean;
  battery: boolean;
  pellet: boolean;
  wood: boolean;
  electricHeating: boolean;
}

export type NavId = "overview" | "forecast" | "heating" | "roi" | "contracts" | "settings";

export interface NavItem {
  id: NavId;
  href: string;
  label: string;
  /** Libellé court de la barre d'onglets mobile. */
  short: string;
  /** Faux : absent de la barre d'onglets mobile (5 entrées au plus), accessible autrement. */
  mobile?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "overview", href: "/", label: "Vue d'ensemble", short: "Accueil" },
  // Sur mobile, la page s'ouvre depuis la carte « Demain » de la Vue d'ensemble (T72).
  { id: "forecast", href: "/previsions", label: "Prévisions", short: "Prévisions", mobile: false },
  { id: "heating", href: "/chauffage", label: "Chauffage", short: "Chauffage" },
  { id: "roi", href: "/rentabilite", label: "Rentabilité", short: "ROI" },
  { id: "contracts", href: "/contrats", label: "Contrats", short: "Contrats" },
  { id: "settings", href: "/reglages", label: "Réglages", short: "Réglages" },
];

export interface VisibleModules extends EnergyProfile {
  nav: NavItem[];
  /** Encart « Prévision réapprovisionnement ». */
  refillForecast: boolean;
  /** Onglets Granulés / Bois dans la prévision. */
  fuelTabs: boolean;
  /** Postes marqués « chauffage » sur le tableau de bord. */
  heatingCategories: boolean;
  isRouteVisible(pathname: string): boolean;
}

export function visibleModules(profile: EnergyProfile): VisibleModules {
  const hasFuel = profile.pellet || profile.wood;
  const shown: Record<NavId, boolean> = {
    overview: true,
    forecast: true,
    heating: hasFuel || profile.electricHeating,
    roi: profile.solar || profile.battery,
    contracts: true,
    settings: true,
  };
  const nav = NAV_ITEMS.filter((n) => shown[n.id]);
  const hidden = NAV_ITEMS.filter((n) => !shown[n.id]);

  return {
    ...profile,
    nav,
    refillForecast: hasFuel,
    fuelTabs: profile.pellet && profile.wood,
    heatingCategories: profile.electricHeating,
    isRouteVisible: (pathname) =>
      !hidden.some((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)),
  };
}

export const PROFILE_KEYS = ["solar", "battery", "pellet", "wood", "electricHeating"] as const;

/** Libellés courts des profils (liste des utilisateurs de l'administrateur). */
export const PROFILE_LABELS: Record<keyof EnergyProfile, string> = {
  solar: "Solaire",
  battery: "Batterie",
  pellet: "Granulés",
  wood: "Bois",
  electricHeating: "Chauffage électrique",
};

/** Libellés des profils activés, dans l'ordre de PROFILE_KEYS. */
export const activeProfileLabels = (profile: EnergyProfile): string[] =>
  PROFILE_KEYS.filter((k) => profile[k]).map((k) => PROFILE_LABELS[k]);

/** Validation d'un profil reçu du client (formulaire Réglages). */
export function parseProfile(input: unknown): EnergyProfile | null {
  if (typeof input !== "object" || input === null) return null;
  const record = input as Record<string, unknown>;
  const out = {} as EnergyProfile;
  for (const key of PROFILE_KEYS) {
    if (typeof record[key] !== "boolean") return null;
    out[key] = record[key];
  }
  return out;
}
