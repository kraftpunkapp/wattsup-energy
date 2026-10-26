import type { IconName } from "@/components/ui/icon";

// Sections de Réglages : un ou deux encarts chacune, regroupées par thème. Sur ordinateur,
// menu vertical à gauche ; sur téléphone, liste des sections puis « ‹ Réglages » dans chacune.
// Les liens des autres écrans visent directement la section utile (`settingsHref`).

export const SETTINGS_GROUPS = [
  { id: "foyer", label: "Mon foyer" },
  { id: "donnees", label: "Home Assistant et données" },
  { id: "suivi", label: "Affichage et suivi" },
] as const;

export const SETTINGS_TABS = [
  {
    id: "profil",
    group: "foyer",
    icon: "sliders",
    label: "Profil",
    description: "Les équipements de votre foyer : l'interface masque le reste.",
  },
  {
    id: "localisation",
    group: "foyer",
    icon: "pin",
    label: "Localisation",
    description: "Votre commune, pour la météo.",
  },
  {
    id: "equipements",
    group: "foyer",
    icon: "sun",
    label: "Équipements",
    description: "Revente, charge de la batterie, sacs, palettes et saison de chauffe.",
  },
  {
    id: "postes",
    group: "foyer",
    icon: "plug",
    label: "Postes",
    description: "Les appareils ou circuits suivis séparément.",
  },
  {
    id: "appareils",
    group: "foyer",
    icon: "washer",
    label: "Appareils",
    description: "Les appareils à décaler au moment le moins cher : lave-linge, ballon, véhicule…",
  },
  {
    id: "home-assistant",
    group: "donnees",
    icon: "home",
    label: "Home Assistant",
    description: "Token, granularité des envois et derniers envois reçus.",
  },
  {
    id: "historique",
    group: "donnees",
    icon: "upload",
    label: "Historique",
    description: "Votre historique, depuis Home Assistant ou un fichier CSV.",
  },
  {
    id: "donnees",
    group: "donnees",
    icon: "edit",
    label: "Données",
    description: "Contrôler et corriger les valeurs enregistrées.",
  },
  {
    id: "vue-ensemble",
    group: "suivi",
    icon: "layout",
    label: "Vue d'ensemble",
    description: "Les blocs affichés sur la Vue d'ensemble : masquez ceux qui ne vous servent pas.",
  },
  {
    id: "alertes",
    group: "suivi",
    icon: "bolt",
    label: "Alertes",
    description:
      "Ce qui s'affiche dans « À surveiller » sur la Vue d'ensemble, et à partir de quand.",
  },
] as const satisfies readonly {
  id: string;
  group: (typeof SETTINGS_GROUPS)[number]["id"];
  icon: IconName;
  label: string;
  description: string;
}[];

export type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

/** Sections du foyer : « Équipements » seulement avec du solaire, une batterie ou un combustible. */
export const settingsTabsFor = (p: {
  solar: boolean;
  battery: boolean;
  pellet: boolean;
  wood: boolean;
}): SettingsTab[] =>
  SETTINGS_TABS.map((t) => t.id).filter(
    (id) => id !== "equipements" || p.solar || p.battery || p.pellet || p.wood,
  );

/** Section demandée ; à défaut, ou si elle est masquée par le profil, la première. */
export function parseSettingsTab(raw: unknown, visible: readonly SettingsTab[]): SettingsTab {
  const tab = SETTINGS_TABS.find((t) => t.id === raw)?.id;
  return tab && visible.includes(tab) ? tab : "profil";
}

export const settingsHref = (tab: SettingsTab) => `/reglages?onglet=${tab}`;
