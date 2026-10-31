"use client";

import { useSyncExternalStore } from "react";

/**
 * Horloge partagée qui avance chaque seconde (un seul minuteur pour toute la page).
 * Elle sert uniquement à RAFRAÎCHIR L'AFFICHAGE des comptes à rebours : le temps
 * restant est toujours calculé à partir des heures de fin envoyées par le serveur.
 *
 * Valeur 0 pendant le rendu serveur et l'hydratation : l'appelant utilise alors
 * l'heure du serveur, pour que le HTML et la première peinture soient identiques.
 */
let current = 0;
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  subscribers.add(cb);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      subscribers.forEach((fn) => fn());
    }, 1000);
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Heure locale (ms), mise à jour chaque seconde ; 0 au rendu serveur. */
export function useLocalNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 0,
  );
}
