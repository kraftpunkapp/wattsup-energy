import Link from "next/link";
import { Fragment, type ComponentProps, type ReactNode } from "react";
import { Icon, type IconName } from "./icon";

// Briques d'interface partagées (SPEC §2 « Principes d'interface ») : une carte par objet,
// l'élément actif mis en évidence, chiffres lisibles avec libellé et unité, statut explicite,
// actions secondaires en icônes et une action principale claire.

export { Icon, type IconName };
export { Segmented } from "./segmented";
export { segmented } from "./segmented-styles";
export { Legend, type LegendItem } from "./legend";
export { Gauge, type GaugePart } from "./gauge";
export { Banner } from "./banner";

export const button = {
  primary:
    "flex min-h-11 flex-none items-center justify-center gap-1.5 rounded-control bg-ink px-4 text-[13px] font-medium text-bg disabled:opacity-60",
  secondary:
    "flex min-h-11 flex-none items-center justify-center gap-1.5 rounded-control border border-border-strong px-4 text-[13px] font-medium hover:bg-bg disabled:opacity-60",
  icon: "flex size-11 flex-none items-center justify-center rounded-control border border-border text-muted hover:bg-bg hover:text-ink disabled:opacity-60",
  iconDanger:
    "flex size-11 flex-none items-center justify-center rounded-control border border-border text-negative hover:bg-danger-bg disabled:opacity-60",
  /** Bouton icône « fantôme » (modifier, supprimer, masquer) : sans bordure, cadre au survol. */
  ghost:
    "flex size-11 flex-none items-center justify-center rounded-control border border-transparent text-muted hover:border-border hover:bg-bg hover:text-ink disabled:opacity-60",
  ghostDanger:
    "flex size-11 flex-none items-center justify-center rounded-control border border-transparent text-negative hover:border-border hover:bg-danger-bg disabled:opacity-60",
  /** Lien d'action unique : « Libellé → », 600, encre (voir ArrowLink). */
  link: "inline-flex min-h-11 items-center gap-1.5 text-[13px] font-semibold text-ink underline-offset-2 hover:underline",
};

/** Lien d'action de la charte : « Libellé → », graisse 600, encre. */
export function ArrowLink({
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, "className"> & { children: ReactNode }) {
  return (
    <Link {...props} className={button.link}>
      {children}
      <span aria-hidden>→</span>
    </Link>
  );
}

/** Même style, pour une action qui n'est pas une navigation (bouton). */
export function ArrowButton({
  children,
  ...props
}: Omit<ComponentProps<"button">, "className"> & { children: ReactNode }) {
  return (
    <button type="button" {...props} className={button.link}>
      {children}
      <span aria-hidden>→</span>
    </button>
  );
}

/** Libellé de carte ou de section : mono, capitales, espacé. */
export function MonoLabel({
  as: Tag = "span",
  children,
}: {
  as?: "span" | "h2" | "h3" | "p";
  children: ReactNode;
}) {
  return <Tag className="wu-label">{children}</Tag>;
}

export type StatusTone = "ok" | "estimate" | "hc" | "neutral";

const STATUS_DOT: Record<StatusTone, string> = {
  ok: "bg-status-ok",
  estimate: "bg-solar",
  hc: "bg-hc",
  neutral: "bg-neutral-bar",
};

/** Puce de statut : pastille arrondie, point coloré (le sens est aussi écrit). */
export function StatusChip({ tone = "ok", children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-medium text-ink">
      <span aria-hidden className={`size-2 flex-none rounded-full ${STATUS_DOT[tone]}`} />
      {children}
    </span>
  );
}

/**
 * Puce d'écart : « gain » (fond vert pâle, point vert) ou « cost » (surcoût, couleurs de la
 * notice). Toujours avec son signe écrit dans le texte.
 */
export function DeltaChip({ tone, children }: { tone: "gain" | "cost"; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums ${
        tone === "gain" ? "bg-gain-bg text-ink" : "bg-note-bg text-note-ink"
      }`}
    >
      <span
        aria-hidden
        className={`size-2 flex-none rounded-full ${tone === "gain" ? "bg-status-ok" : "bg-solar"}`}
      />
      {children}
    </span>
  );
}

export type BadgeTone = "active" | "neutral" | "soft" | "positive" | "warning";

const BADGE: Record<BadgeTone, string> = {
  active: "bg-accent text-on-accent",
  neutral: "bg-track text-ink-soft",
  soft: "bg-accent/10 text-ink",
  positive: "bg-gain-bg text-ink",
  // Texte plus foncé que le token : 4,8:1 sur le fond teinté (texte de 11 px).
  warning: "bg-track text-warning-ink",
};

/** Pastille de type ou de statut (« En cours », « Terminé », « HP/HC »…). */
export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Carte d'écran : pictogramme, titre, pastilles, description et actions en icônes.
 * `highlight` encadre l'élément actif (contrat en cours, source connectée…).
 */
export function Card({
  icon,
  iconTone,
  title,
  badges,
  description,
  actions,
  highlight = false,
  danger = false,
  flat = false,
  as: Tag = "section",
  children,
}: {
  icon?: IconName;
  /** Teinte de la pastille du pictogramme (neutre par défaut). */
  iconTone?: IconTone;
  title: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  highlight?: boolean;
  /** Action irréversible (suppression du compte) : fond et bordure rouges. */
  danger?: boolean;
  /** Sans cadre ni en-tête (détail déplié d'une carte « À retenir ») : description puis contenu. */
  flat?: boolean;
  as?: "section" | "li";
  children?: ReactNode;
}) {
  // Dans une liste, la carte est sous un titre de groupe (h2) : son titre devient h3.
  const Heading = Tag === "li" ? "h3" : "h2";
  if (flat) {
    return (
      <Tag className="flex flex-col gap-4">
        {description && <div className="text-[13px] text-muted text-pretty">{description}</div>}
        {children}
      </Tag>
    );
  }
  return (
    <Tag
      className={`flex flex-col gap-4 rounded-card border p-4 sm:p-5 ${
        danger
          ? "border-negative/40 bg-danger-bg"
          : highlight
            ? "border-accent bg-surface shadow-[0_0_0_3px_rgba(26,26,26,0.10)]"
            : "border-border bg-surface"
      }`}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span
            className={`hidden size-10 flex-none items-center justify-center rounded-control sm:flex ${
              danger
                ? "bg-negative/10 text-negative"
                : highlight
                  ? "bg-accent text-on-accent"
                  : ICON_TONES[iconTone ?? "neutral"]
            }`}
          >
            <Icon name={icon} size={18} />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Heading className={`text-[15px] font-semibold ${danger ? "text-negative" : ""}`}>
              {title}
            </Heading>
            {badges}
          </div>
          {description && <div className="text-xs text-muted text-pretty">{description}</div>}
        </div>
        {actions && <div className="flex flex-none gap-1.5">{actions}</div>}
      </div>
      {children}
    </Tag>
  );
}

/** Pied de carte : lien discret à gauche, action(s) à droite. */
export function CardFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-track pt-3">{children}</div>
  );
}

/** Grille de tuiles : autant de colonnes que la largeur le permet. */
export const tiles = "grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-2";

/** Valeur chiffrée lisible : libellé au-dessus, chiffre tabulaire, unité à côté. */
export function StatTile({
  label,
  value,
  unit,
  sub,
  dot,
  standalone = false,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  /** Classe de couleur d'une pastille devant le libellé (ex. `bg-grid`). */
  dot?: string;
  /** Tuile posée sur le fond de page (et non dans une carte) : fond blanc bordé. */
  standalone?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-0.5 rounded-control px-2.5 py-2.5 ${
        standalone ? "border border-border bg-surface px-3.5 py-3" : "bg-bg"
      }`}
    >
      <span className="flex items-center gap-1.5 text-[11px] text-muted">
        {dot && <span className={`size-2 rounded-full ${dot}`} />}
        {label}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-1">
        <span className="text-[17px] font-semibold tracking-tight tabular-nums">{value}</span>
        {unit && <span className="text-[11px] text-subtle">{unit}</span>}
      </span>
      {sub && <span className="text-[11px] text-subtle tabular-nums">{sub}</span>}
    </div>
  );
}

/** Teintes des pastilles de pictogramme (une couleur = un sens, comme les tokens). */
export const ICON_TONES = {
  neutral: "bg-bg text-ink-soft",
  grid: "bg-grid/12 text-grid",
  solar: "bg-solar/15 text-solar-ink",
  battery: "bg-battery/15 text-positive",
  pellet: "bg-pellet/15 text-pellet",
  wood: "bg-wood/15 text-wood",
  eheat: "bg-eheat/12 text-eheat",
} as const;
export type IconTone = keyof typeof ICON_TONES;

/** Pastille carrée : pictogramme teinté. */
export function IconChip({
  icon,
  tone = "neutral",
  size = "md",
}: {
  icon: IconName;
  tone?: IconTone;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={`flex flex-none items-center justify-center ${
        size === "lg" ? "size-10 rounded-xl" : "size-8 rounded-[9px]"
      } ${ICON_TONES[tone]}`}
    >
      <Icon name={icon} size={size === "lg" ? 20 : 17} />
    </span>
  );
}

/** Chiffre d'une saison ou d'une période : pastille, libellé, grand chiffre, comparaison. */
export function KpiTile({
  icon,
  tone,
  label,
  value,
  unit,
  sub,
  chip,
}: {
  icon: IconName;
  tone?: IconTone;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  /** Écart avec la période de comparaison (puce gain ou surcoût). */
  chip?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[18px] border border-border bg-surface p-5">
      <span className="flex items-center gap-2.5">
        <IconChip icon={icon} tone={tone} />
        <span className="wu-label">{label}</span>
      </span>
      <span className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="wu-amount text-2xl leading-tight">{value}</span>
        {unit && <span className="text-lg font-semibold text-ink-soft">{unit}</span>}
      </span>
      {(sub || chip) && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted tabular-nums">
          {sub}
          {chip}
        </span>
      )}
    </div>
  );
}

export interface Figure {
  label: string;
  value: string;
  unit?: string;
  /** Classe de couleur du chiffre (ex. `text-pellet`), pour le résultat d'un calcul. */
  tone?: string;
}

/**
 * Chiffres de détail, sans fond : ils soutiennent la réponse de la carte sans rivaliser
 * avec elle. Séparés par un trait fin, ou par des opérateurs quand ils forment un calcul
 * (`ops[i]` entre le chiffre i et le suivant, ex. « − » puis « = »).
 */
export function Figures({ items, ops }: { items: Figure[]; ops?: string[] }) {
  // Colonnes égales posées sur un filet : le calcul est ancré à la carte, sans fond.
  const columns = items.map(() => "minmax(0,1fr)").join(" auto ");
  return (
    <div
      className="grid items-end gap-x-3 border-t border-track pt-3"
      style={{ gridTemplateColumns: columns }}
    >
      {items.map((f, i) => (
        <Fragment key={f.label}>
          {i > 0 &&
            (ops?.[i - 1] ? (
              <span aria-hidden className="pb-px text-[17px] leading-none text-subtle">
                {ops[i - 1]}
              </span>
            ) : (
              <span aria-hidden className="h-8 w-px self-center bg-border" />
            ))}
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] leading-tight text-muted text-pretty">{f.label}</span>
            <span className="flex flex-wrap items-baseline gap-x-1">
              <span
                className={`text-[17px] leading-none font-semibold tabular-nums ${f.tone ?? ""}`}
              >
                {f.value}
              </span>
              {f.unit && <span className="text-[11px] text-subtle">{f.unit}</span>}
            </span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Encart d'explication : une donnée incohérente ou une étape manquante, dite en clair,
 * avec si possible l'action qui la corrige en un clic.
 */
export function Notice({
  tone = "warning",
  title,
  children,
  action,
  icon,
}: {
  tone?: "warning" | "info";
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Pictogramme sur pastille blanche, en tête de l'encart. */
  icon?: IconName;
}) {
  return (
    <div
      role="status"
      className={`flex flex-col gap-3 rounded-card border p-4 text-[13px] text-pretty ${
        tone === "warning"
          ? "border-transparent bg-note-bg text-note-ink"
          : "border-border-strong bg-track"
      }`}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span
            aria-hidden
            className="flex size-8 flex-none items-center justify-center rounded-[9px] bg-surface text-ink-soft"
          >
            <Icon name={icon} size={17} />
          </span>
        )}
        <p className="min-w-0 flex-1 self-center">
          <span className="font-semibold">{title}</span> {children}
        </p>
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/** Remarque dans une carte : pictogramme et fond teinté, texte court. */
export function Callout({
  icon = "info",
  tone = "note",
  children,
}: {
  icon?: IconName;
  tone?: "note" | "neutral";
  children: ReactNode;
}) {
  return (
    <p
      className={`flex items-start gap-3 rounded-xl p-3.5 text-sm text-pretty ${
        tone === "note" ? "bg-note-bg text-note-ink" : "bg-bg text-ink-soft"
      }`}
    >
      <span aria-hidden className="mt-px flex-none">
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}

/** Titre de groupe au-dessus d'une liste de cartes. */
export function GroupTitle({ children }: { children: ReactNode }) {
  return <h2 className="wu-label px-1">{children}</h2>;
}

/** Ligne à interrupteur : libellé, description, pastille de couleur facultative. */
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
  dot,
  disabled = false,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: () => void;
  dot?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className="flex min-h-11 items-center gap-3 border-t border-track py-3 text-left first:border-t-0 disabled:opacity-60"
    >
      {dot && <span className={`size-2.5 flex-none rounded-[3px] ${dot}`} />}
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description && <span className="text-xs text-subtle text-pretty">{description}</span>}
      </span>
      <SwitchTrack checked={checked} />
    </button>
  );
}

/** Piste et pastille d'un interrupteur (la pastille glisse à droite quand c'est actif). */
function SwitchTrack({ checked, small = false }: { checked: boolean; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex flex-none rounded-full transition-colors ${
        small ? "h-5 w-9 p-[3px]" : "h-6 w-[42px] p-[3px]"
      } ${checked ? "justify-end bg-ink" : "justify-start bg-switch-off"}`}
    >
      <span
        className={`${small ? "size-[14px]" : "size-[18px]"} rounded-full bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
      />
    </span>
  );
}

/** Option activable dans une barre d'outils de graphique : petit interrupteur et libellé. */
export function Toggle({
  label,
  checked,
  onChange,
  ariaLabel,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  /** Nom accessible plus précis que le libellé visible (plusieurs interrupteurs identiques). */
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className="flex min-h-9 items-center gap-2 text-[13px] font-medium text-ink"
    >
      <SwitchTrack checked={checked} small />
      {label}
    </button>
  );
}
