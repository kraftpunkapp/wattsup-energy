"use client";

import { useState, useTransition } from "react";
import { button, Card, SwitchRow, Toggle } from "@/components/ui";
import { ALERT_LIMITS, type AlertSettings } from "@/domain/alerts";
import { saveAlertSettingsAction } from "@/server/actions/alerts";

// Réglages › Alertes (T44) : chaque alerte s'active ou se coupe, et son seuil se règle.
// Seules les alertes des modules du profil sont proposées ; les autres gardent leur réglage.

type Name = keyof AlertSettings;

const ROWS: { name: Name; label: string; before: string; unit: string; after: string }[] = [
  {
    name: "fuelStock",
    label: "Stock de combustible bas",
    before: "Moins de",
    unit: "semaines",
    after: "de stock au rythme des 3 dernières semaines.",
  },
  {
    name: "haSilent",
    label: "Home Assistant silencieux",
    before: "Aucun envoi depuis",
    unit: "h",
    after: "(26 h au moins en envoi quotidien).",
  },
  {
    name: "solarYield",
    label: "Production solaire en baisse",
    before: "Rendement",
    unit: "%",
    after: "sous l'habitude, 3 jours de suite, pour le même ensoleillement.",
  },
  {
    name: "budget",
    label: "Dépense du mois en hausse",
    before: "Dépense",
    unit: "%",
    after: "au-dessus des mêmes jours de l'an dernier (à partir du 7 du mois).",
  },
  {
    name: "marketOffer",
    label: "Offre du marché moins chère",
    before: "Économie d'au moins",
    unit: "€/an",
    after:
      "par rapport à votre contrat actuel, sur vos 12 derniers mois (puissance du compteur renseignée).",
  },
];

const inputClass =
  "h-8 w-16 rounded-[8px] border border-border-strong bg-surface px-2 text-center text-[13px] tabular-nums outline-none focus:border-ink disabled:opacity-50";

export function AlertsSettingsCard({
  initial,
  visible,
  email,
}: {
  initial: AlertSettings;
  /** L'instance envoie des emails : case « Recevoir par email » sur chaque alerte. */
  email: boolean;
  /** Alertes proposées selon le profil. */
  visible: Name[];
}) {
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(settings) !== JSON.stringify(initial);

  const update = (
    name: Name,
    patch: Partial<{ enabled: boolean; email: boolean; value: number }>,
  ) => {
    const key = ALERT_LIMITS[name].key;
    const current = settings[name] as unknown as { enabled: boolean; email: boolean } & Record<
      string,
      number
    >;
    setSettings({
      ...settings,
      [name]: {
        enabled: patch.enabled ?? current.enabled,
        email: patch.email ?? current.email,
        [key]: patch.value ?? current[key],
      },
    });
    setMessage(null);
  };

  const save = () =>
    startTransition(async () => {
      const res = await saveAlertSettingsAction(settings);
      setMessage(
        res.ok
          ? { ok: true, text: "Alertes enregistrées." }
          : { ok: false, text: `Seuil invalide : ${res.errors[0] ?? ""}.` },
      );
    });

  return (
    <Card
      icon="bolt"
      title="Alertes"
      description={
        email
          ? "Affichées en tête de la Vue d'ensemble, avec une pastille sur l'écran concerné ; par email si vous le demandez (une fois, puis de nouveau si l'alerte s'aggrave)."
          : "Affichées en tête de la Vue d'ensemble, avec une pastille sur l'écran concerné."
      }
    >
      <ul className="flex flex-col">
        {ROWS.filter((r) => visible.includes(r.name)).map((r) => {
          const limit = ALERT_LIMITS[r.name];
          const entry = settings[r.name];
          const value = (entry as unknown as Record<string, number>)[limit.key];
          return (
            <li key={r.name} className="flex flex-col border-t border-track first:border-t-0">
              <SwitchRow
                label={r.label}
                checked={entry.enabled}
                onChange={() => update(r.name, { enabled: !entry.enabled })}
              />
              <p
                className={`pb-3 text-xs leading-8 text-muted ${entry.enabled ? "" : "opacity-50"}`}
              >
                {r.before}{" "}
                <input
                  type="number"
                  inputMode="numeric"
                  min={limit.min}
                  max={limit.max}
                  value={value}
                  disabled={!entry.enabled}
                  aria-label={`${r.label} : seuil en ${r.unit}`}
                  onChange={(e) => update(r.name, { value: Number(e.target.value) })}
                  className={inputClass}
                />{" "}
                {r.unit} {r.after}
              </p>
              {email && entry.enabled && (
                <div className="-mt-1 pb-3">
                  <Toggle
                    label="Recevoir aussi par email"
                    ariaLabel={`${r.label} : recevoir par email`}
                    checked={entry.email}
                    onChange={() => update(r.name, { email: !entry.email })}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={save}
          className={button.primary}
        >
          Enregistrer
        </button>
        {message && (
          <p role="status" className={`text-sm ${message.ok ? "text-positive" : "text-negative"}`}>
            {message.text}
          </p>
        )}
      </div>
    </Card>
  );
}
