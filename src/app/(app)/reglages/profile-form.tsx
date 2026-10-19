"use client";

import { callAction } from "@/lib/action";
import { useOptimistic, useState, useTransition } from "react";
import { PROFILE_KEYS, type EnergyProfile } from "@/domain/profile";
import { updateProfileAction } from "@/server/actions/profile";
import { Badge, Card, SwitchRow } from "@/components/ui";

const TOGGLES: Record<keyof EnergyProfile, { label: string; desc: string; color: string }> = {
  solar: {
    label: "Production solaire",
    desc: "Panneaux photovoltaïques",
    color: "bg-solar",
  },
  battery: { label: "Batterie", desc: "Cycles de charge et décharge", color: "bg-battery" },
  pellet: { label: "Granulés", desc: "Sacs et palettes de pellets", color: "bg-pellet" },
  wood: { label: "Bois", desc: "Stères, bûches", color: "bg-wood" },
  electricHeating: {
    label: "Chauffage électrique",
    desc: "Poste dédié dans la consommation",
    color: "bg-eheat",
  },
};

export function ProfileForm({ initial }: { initial: EnergyProfile }) {
  const [saved, setSaved] = useState(initial);
  const [profile, setOptimistic] = useOptimistic(saved);
  const [error, setError] = useState(false);
  const [, startTransition] = useTransition();

  const activeCount = PROFILE_KEYS.filter((k) => profile[k]).length;

  const toggle = (key: keyof EnergyProfile) => {
    const next = { ...profile, [key]: !profile[key] };
    setError(false);
    startTransition(async () => {
      setOptimistic(next);
      const res = await callAction(() => updateProfileAction(next));
      if (res.ok) setSaved(next);
      else setError(true);
    });
  };

  return (
    <Card
      icon="sliders"
      title="Profil énergétique"
      badges={
        <Badge>
          {activeCount > 1 ? `${activeCount} modules actifs` : `${activeCount} module actif`}
        </Badge>
      }
      description="Les modules désactivés sont masqués dans toute l'interface."
    >
      <div className="flex flex-col">
        {PROFILE_KEYS.map((key) => {
          const t = TOGGLES[key];
          const on = profile[key];
          return (
            <SwitchRow
              key={key}
              label={t.label}
              description={t.desc}
              checked={on}
              dot={t.color}
              onChange={() => toggle(key)}
            />
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-negative">
          Enregistrement impossible. Réessayez.
        </p>
      )}
    </Card>
  );
}
