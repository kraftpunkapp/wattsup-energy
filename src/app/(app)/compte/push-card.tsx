"use client";

import { callAction } from "@/lib/action";
import { useEffect, useState, useTransition } from "react";
import { button, Card, Icon, Notice } from "@/components/ui";
import { subscribePushAction, testPushAction, unsubscribePushAction } from "@/server/actions/push";

// Notifications sur cet appareil (T49) : les alertes de « À surveiller » arrivent sur le
// téléphone ou l'ordinateur, une fois par alerte (et de nouveau si elle s'aggrave). Un
// abonnement par appareil ; la liste permet d'en retirer un.

interface Device {
  endpoint: string;
  label: string;
  createdOn: string;
}

type Support = "checking" | "ok" | "unsupported" | "ios-browser" | "denied";

/** Clé VAPID publique (base64url) → octets attendus par pushManager.subscribe. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function PushCard({ publicKey, devices }: { publicKey: string; devices: Device[] }) {
  const [support, setSupport] = useState<Support>("checking");
  const [current, setCurrent] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupport(ios && !standalone ? "ios-browser" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") setSupport("denied");
    else setSupport("ok");
    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((r) => r?.pushManager.getSubscription())
      .then((s) => setCurrent(s?.endpoint ?? null))
      .catch(() => setCurrent(null));
  }, []);

  const subscribed = current !== null && devices.some((d) => d.endpoint === current);

  const enable = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setSupport(permission === "denied" ? "denied" : "ok");
          return;
        }
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        });
        const res = await callAction(() => subscribePushAction(sub.toJSON()));
        if (!res.ok) throw new Error("abonnement refusé");
        setCurrent(sub.endpoint);
        setMessage({ ok: true, text: "Notifications activées sur cet appareil." });
      } catch {
        setMessage({ ok: false, text: "Activation impossible sur ce navigateur. Réessayez." });
      }
    });

  const disable = (endpoint: string) =>
    startTransition(async () => {
      setMessage(null);
      if (endpoint === current) {
        const registration = await navigator.serviceWorker.getRegistration("/sw.js");
        await (await registration?.pushManager.getSubscription())?.unsubscribe();
        setCurrent(null);
      }
      await unsubscribePushAction(endpoint);
    });

  const test = () =>
    startTransition(async () => {
      const { delivered } = await testPushAction();
      setMessage(
        delivered > 0
          ? {
              ok: true,
              text: `Notification d'essai envoyée (${delivered} appareil${delivered > 1 ? "s" : ""}).`,
            }
          : { ok: false, text: "Aucun appareil n'a pu être joint." },
      );
    });

  return (
    <Card
      icon="bolt"
      title="Notifications"
      description="Les alertes de « À surveiller » sur votre téléphone ou votre ordinateur : une fois par alerte, et de nouveau si elle s'aggrave."
    >
      {support === "ios-browser" && (
        <Notice tone="info" title="Sur iPhone :">
          ajoutez d&apos;abord WattsUp à l&apos;écran d&apos;accueil (Partager › Sur l&apos;écran
          d&apos;accueil), puis ouvrez-le depuis son icône et revenez ici.
        </Notice>
      )}
      {support === "unsupported" && (
        <p className="text-[13px] text-muted">Ce navigateur ne gère pas les notifications.</p>
      )}
      {support === "denied" && (
        <Notice tone="info" title="Notifications bloquées :">
          autorisez-les pour ce site dans les réglages du navigateur, puis revenez ici.
        </Notice>
      )}
      {support === "ok" && (
        <div className="flex flex-wrap items-center gap-2">
          {subscribed ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => current && disable(current)}
              className={button.secondary}
            >
              Désactiver sur cet appareil
            </button>
          ) : (
            <button type="button" disabled={pending} onClick={enable} className={button.primary}>
              Activer sur cet appareil
            </button>
          )}
          {devices.length > 0 && (
            <button type="button" disabled={pending} onClick={test} className={button.secondary}>
              Envoyer un essai
            </button>
          )}
        </div>
      )}
      {devices.length > 0 && (
        <ul className="flex flex-col border-t border-track pt-2">
          {devices.map((d) => (
            <li key={d.endpoint} className="flex items-center gap-3 py-1.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">
                  {d.label}
                  {d.endpoint === current && (
                    <span className="font-normal text-subtle"> (cet appareil)</span>
                  )}
                </span>
                <span className="text-xs text-muted">Activé le {d.createdOn}</span>
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => disable(d.endpoint)}
                aria-label={`Retirer ${d.label}`}
                title="Ne plus envoyer de notifications à cet appareil"
                className={button.iconDanger}
              >
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-positive" : "text-negative"}`}>
          {message.text}
        </p>
      )}
    </Card>
  );
}
