"use client";

import { callAction } from "@/lib/action";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, button, Card, CardFooter, Icon, Notice } from "@/components/ui";
import {
  CATEGORY_SWATCH,
  CategoryTile,
  categoryColor,
  categoryIcon,
} from "@/components/ui/category";
import { CATEGORY_COLORS, CATEGORY_ICONS, slugify, type CategoryInput } from "@/domain/categories";
import {
  deleteCategoryAction,
  saveCategoryAction,
  type CategoryActionResult,
} from "@/server/actions/categories";

export interface CategoryItem {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  color: string | null;
  isHeating: boolean;
  kwh30d: number;
  /** ISO, null si aucune donnée reçue. */
  lastDataAt: string | null;
}

const ICON_LABELS: Record<(typeof CATEGORY_ICONS)[number], string> = {
  droplet: "Eau",
  flame: "Chauffage",
  plug: "Prise",
  car: "Véhicule",
  washer: "Lavage",
  snowflake: "Froid",
  fan: "Ventilation",
  waves: "Piscine",
  monitor: "Bureau",
  home: "Maison",
};

const kwhFmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: n < 10 ? 1 : 0, maximumFractionDigits: 1 });

const inputClass =
  "h-10 w-full rounded-[8px] border border-border-strong bg-surface px-3 text-[13px] outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-grid/30";
const labelClass = "flex flex-col gap-1.5 text-xs text-muted";

const blank = (name = "", slug = ""): CategoryInput => ({
  name,
  slug,
  icon: "plug",
  color: "grid",
  isHeating: false,
});

function CopySlug({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copier le slug « ${slug} » pour Home Assistant`}
      className={`${button.secondary} h-8 px-2.5 text-xs`}
      onClick={async () => {
        await navigator.clipboard.writeText(slug);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? (
        "Copié"
      ) : (
        <>
          Copier<span className="hidden sm:inline"> pour HA</span>
        </>
      )}
    </button>
  );
}

function CategoryForm({
  id,
  initial,
  hasData,
  onDone,
}: {
  id: string | null;
  initial: CategoryInput;
  hasData: boolean;
  onDone: () => void;
}) {
  const [value, setValue] = useState(initial);
  // Le slug suit le nom tant qu'on ne l'a pas modifié à la main (création uniquement).
  const [slugTouched, setSlugTouched] = useState(id !== null || initial.slug !== "");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<CategoryInput>) => setValue((v) => ({ ...v, ...patch }));
  const renamed = id !== null && hasData && value.slug !== initial.slug;

  const save = () =>
    startTransition(async () => {
      const res: CategoryActionResult = await callAction(() => saveCategoryAction(id, value));
      if (res.ok) onDone();
      else setErrors(res.errors);
    });

  return (
    <div className="flex flex-col gap-4 rounded-control border border-border p-4">
      <h3 className="text-[15px] font-semibold">
        {id ? `Modifier « ${initial.name} »` : "Nouveau poste"}
      </h3>
      <label className={labelClass}>
        Nom
        <input
          value={value.name}
          onChange={(e) =>
            set({
              name: e.target.value,
              ...(slugTouched ? {} : { slug: slugify(e.target.value) }),
            })
          }
          placeholder="ex. Chauffe-eau"
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        Slug (clé envoyée par Home Assistant)
        <input
          value={value.slug}
          onChange={(e) => {
            setSlugTouched(true);
            set({ slug: e.target.value.trim() });
          }}
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <span className="text-[11px] text-subtle text-pretty">
          Minuscules, chiffres et tirets. Dans l&apos;automatisation Home Assistant, associez-le à
          un capteur d&apos;énergie cumulée :{" "}
          <span className="font-mono">{value.slug || "slug"}: sensor.…</span>
        </span>
      </label>
      {renamed && (
        <Notice title="Les données déjà reçues seront renommées.">
          Changez aussi le slug dans l&apos;automatisation Home Assistant, sinon les prochains
          envois seront ignorés.
        </Notice>
      )}

      <fieldset className="flex flex-col gap-1.5">
        <legend className="pb-1.5 text-xs text-muted">Pictogramme</legend>
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {CATEGORY_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={value.icon === icon}
              aria-label={ICON_LABELS[icon]}
              title={ICON_LABELS[icon]}
              onClick={() => set({ icon })}
              className={`flex size-10 items-center justify-center rounded-[8px] border ${
                value.icon === icon
                  ? `border-ink ${CATEGORY_SWATCH[value.color].tile}`
                  : "border-border text-muted hover:bg-bg"
              }`}
            >
              <Icon name={icon} size={18} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="pb-1.5 text-xs text-muted">Couleur</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup">
          {CATEGORY_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={value.color === color}
              aria-label={CATEGORY_SWATCH[color].label}
              title={CATEGORY_SWATCH[color].label}
              onClick={() => set({ color })}
              className={`size-8 rounded-full ${CATEGORY_SWATCH[color].bg} ${
                value.color === color ? "ring-2 ring-ink ring-offset-2" : ""
              }`}
            />
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={value.isHeating}
          onChange={(e) => set({ isHeating: e.target.checked })}
          className="mt-0.5 size-4 accent-[var(--color-grid)]"
        />
        <span className="flex flex-col gap-0.5">
          Poste de chauffage
          <span className="text-[11px] text-subtle">
            Compté dans le coût de chauffe (écran Chauffage).
          </span>
        </span>
      </label>

      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-sm text-negative">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={save} className={button.primary}>
          Enregistrer
        </button>
        <button type="button" onClick={onDone} className={button.secondary}>
          Annuler
        </button>
      </div>
    </div>
  );
}

function CategoryRow({
  item,
  timezone,
  pending,
  onEdit,
  onDelete,
}: {
  item: CategoryItem;
  timezone: string;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const last =
    item.lastDataAt &&
    new Date(item.lastDataAt).toLocaleString("fr-FR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    });
  return (
    <li className="flex flex-col gap-3 rounded-control border border-border p-3">
      <div className="flex items-start gap-3">
        <CategoryTile icon={item.icon} color={item.color} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{item.name}</h3>
            {item.isHeating && <Badge tone="warning">Chauffage</Badge>}
            {!last && <Badge>Aucune donnée</Badge>}
          </div>
          <span className="text-xs text-muted tabular-nums">
            {last ? (
              <>
                <span className="font-semibold text-ink">{kwhFmt(item.kwh30d)} kWh</span> sur 30
                jours · dernière donnée le {last}
              </>
            ) : (
              "Associez ce slug à un capteur dans l'automatisation Home Assistant."
            )}
          </span>
        </div>
        <div className="flex flex-none gap-1.5">
          <button
            type="button"
            className={button.icon}
            aria-label={`Modifier « ${item.name} »`}
            title="Modifier"
            onClick={onEdit}
          >
            <Icon name="edit" />
          </button>
          <button
            type="button"
            disabled={pending}
            className={button.iconDanger}
            aria-label={`Supprimer « ${item.name} »`}
            title="Supprimer"
            onClick={onDelete}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-[8px] bg-bg px-3 py-1.5 font-mono text-xs">
          {item.slug}
        </code>
        <CopySlug slug={item.slug} />
      </div>
    </li>
  );
}

type Editing = { id: string | null; initial: CategoryInput; hasData: boolean } | null;

const titleCase = (slug: string) => {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function CategoriesCard({
  categories,
  unknown,
  timezone,
}: {
  categories: CategoryItem[];
  /** Slugs envoyés par HA sans poste correspondant. */
  unknown: string[];
  timezone: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const done = () => {
    setEditing(null);
    router.refresh();
  };
  const remove = (item: CategoryItem) => {
    const data = item.lastDataAt ? " et toutes ses données reçues" : "";
    if (!confirm(`Supprimer le poste « ${item.name} »${data} ?`)) return;
    startTransition(async () => {
      const res = await callAction(() => deleteCategoryAction(item.id));
      setErrors(res.ok ? [] : res.errors);
      router.refresh();
    });
  };
  const count = categories.length;

  return (
    <Card
      icon="plug"
      title="Postes de consommation"
      badges={count > 0 && <Badge>{count > 1 ? `${count} postes` : "1 poste"}</Badge>}
      description="Chaque poste suit un capteur d'énergie de Home Assistant (chauffe-eau, chauffage, véhicule…), identifié par son slug."
    >
      {!editing &&
        unknown.map((slug) => (
          <Notice
            key={slug}
            title={`Home Assistant envoie « ${slug} »,`}
            action={
              <button
                type="button"
                className={button.primary}
                onClick={() =>
                  setEditing({ id: null, initial: blank(titleCase(slug), slug), hasData: false })
                }
              >
                Créer le poste « {slug} »
              </button>
            }
          >
            qui ne correspond à aucun poste : ses kWh sont ignorés.
          </Notice>
        ))}

      {count === 0 && !editing && unknown.length === 0 && (
        <Notice tone="info" title="Aucun poste pour l'instant.">
          Ajoutez-en un, par exemple « Chauffe-eau » si vous mesurez l&apos;énergie envoyée au
          ballon.
        </Notice>
      )}

      {editing?.id === null && (
        <CategoryForm id={null} initial={editing.initial} hasData={false} onDone={done} />
      )}

      {count > 0 && (
        <ul className="flex flex-col gap-2">
          {categories.map((item) =>
            editing?.id === item.id ? (
              <li key={item.id}>
                <CategoryForm
                  id={item.id}
                  initial={editing.initial}
                  hasData={editing.hasData}
                  onDone={done}
                />
              </li>
            ) : (
              <CategoryRow
                key={item.id}
                item={item}
                timezone={timezone}
                pending={pending}
                onEdit={() =>
                  setEditing({
                    id: item.id,
                    hasData: item.lastDataAt !== null,
                    initial: {
                      name: item.name,
                      slug: item.slug,
                      icon: categoryIcon(item.icon),
                      color: categoryColor(item.color),
                      isHeating: item.isHeating,
                    },
                  })
                }
                onDelete={() => remove(item)}
              />
            ),
          )}
        </ul>
      )}

      {errors.length > 0 && (
        <p role="alert" className="text-sm text-negative">
          {errors.join(" ; ")}
        </p>
      )}

      {!editing && (
        <CardFooter>
          <button
            type="button"
            className={`${button.secondary} ml-auto`}
            onClick={() => setEditing({ id: null, initial: blank(), hasData: false })}
          >
            <Icon name="plus" size={14} />
            Ajouter un poste
          </button>
        </CardFooter>
      )}
    </Card>
  );
}
