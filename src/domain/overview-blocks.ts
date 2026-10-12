// Vue d'ensemble personnalisable (SPEC §9, T50) : blocs que l'utilisateur peut masquer, et
// ceux qui s'appliquent à son foyer (profil, contrat, envois). Pur.

export const OVERVIEW_BLOCKS = [
  {
    id: "advice",
    label: "Quand consommer",
    description: "Surplus solaire, heures creuses et couleur Tempo de demain.",
  },
  {
    id: "contract",
    label: "Contrat moins cher",
    description: "Encart quand un autre contrat vous aurait coûté moins cher.",
  },
  {
    id: "peak",
    label: "Heures pleines et heures creuses",
    description: "Part de l'électricité achetée en heures creuses et en heures pleines.",
  },
  {
    id: "baseload",
    label: "Talon de consommation",
    description: "Ce que la maison consomme en permanence, mesuré la nuit.",
  },
] as const;

export type OverviewBlock = (typeof OVERVIEW_BLOCKS)[number]["id"];

const IDS = new Set<string>(OVERVIEW_BLOCKS.map((b) => b.id));

/** Blocs masqués, lus dans les réglages du foyer (valeurs inconnues ignorées). */
export function hiddenBlocks(raw: unknown): OverviewBlock[] {
  const hidden = (raw as { hidden?: unknown } | null | undefined)?.hidden;
  if (!Array.isArray(hidden)) return [];
  return [
    ...new Set(hidden.filter((h): h is OverviewBlock => typeof h === "string" && IDS.has(h))),
  ];
}

/** Liste des blocs masqués après avoir masqué ou réaffiché `block`. */
export const withBlockHidden = (
  hidden: readonly OverviewBlock[],
  block: OverviewBlock,
  hide: boolean,
): OverviewBlock[] => (hide ? [...new Set([...hidden, block])] : hidden.filter((h) => h !== block));

/**
 * Blocs qui ont lieu d'être pour ce foyer (les autres ne sont pas proposés dans Réglages) :
 * conseils avec du solaire ou un contrat à heures creuses ; comparaison avec au moins deux
 * contrats ; HP/HC avec un contrat HP/HC ou Tempo ; talon en envoi horaire.
 */
export function applicableBlocks(f: {
  solar: boolean;
  granularity: "hourly" | "daily";
  /** Type du contrat en cours ; null sans contrat. */
  contractKind: "base" | "hphc" | "tempo" | "custom" | "spot" | null;
  contracts: number;
}): OverviewBlock[] {
  const offPeak = f.contractKind === "hphc" || f.contractKind === "tempo";
  return OVERVIEW_BLOCKS.map((b) => b.id).filter((id) => {
    if (id === "advice") return f.solar || offPeak;
    if (id === "contract") return f.contracts >= 2;
    if (id === "peak") return offPeak;
    return f.granularity === "hourly";
  });
}
