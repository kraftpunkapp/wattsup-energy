"use client";

import { useState, useTransition } from "react";
import { Card, SwitchRow } from "@/components/ui";
import type { TomorrowNoticeSettings } from "@/domain/forecast/notify";
import { callAction } from "@/lib/action";
import { saveTomorrowNoticeAction } from "@/server/actions/settings";

// Réglages › Alertes : notification du soir « Créneaux de demain » (T74, SPEC §7.14).

export function TomorrowNoticeCard({
  initial,
  email,
  push,
}: {
  initial: TomorrowNoticeSettings;
  /** L'instance envoie des emails. */
  email: boolean;
  /** L'instance envoie des notifications push. */
  push: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  const save = (next: TomorrowNoticeSettings) => {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const res = await callAction(() => saveTomorrowNoticeAction(next));
      setError(!res.ok);
      if (!res.ok) setValue(previous);
    });
  };
  if (!email && !push) return null;
  return (
    <Card
      icon="washer"
      title="Créneaux de demain"
      description="Le soir vers 20 h, quand un appareil gagne à être lancé à un moment précis demain : au moins 0,30 € d'économie, ou couvert à 80 % par le solaire. Une seule par soir."
    >
      <div className="flex flex-col">
        <SwitchRow
          label="Me prévenir le soir"
          description={
            push
              ? "Notification sur vos appareils abonnés (Mon compte › Notifications)."
              : undefined
          }
          checked={value.enabled}
          disabled={pending}
          onChange={() => save({ ...value, enabled: !value.enabled })}
        />
        {email && (
          <SwitchRow
            label="Recevoir aussi par email"
            checked={value.email}
            disabled={pending || !value.enabled}
            onChange={() => save({ ...value, email: !value.email })}
          />
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-negative">
          Enregistrement impossible : réessayez.
        </p>
      )}
    </Card>
  );
}
