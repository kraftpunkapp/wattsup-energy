import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Faux tant que la page n'est pas hydratée : le bouton d'envoi reste désactivé, sinon un envoi
    avant le chargement du script soumet le formulaire en GET et met le mot de passe dans l'URL. */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
