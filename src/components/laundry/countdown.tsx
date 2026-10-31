"use client";

import { formatCountdown, spokenCountdown } from "@/lib/format";

import { useRemaining } from "./laundry-provider";

/**
 * Compte à rebours vers une heure fournie par le serveur (`until`).
 * L'affichage est recalculé chaque seconde à partir de cette heure : aucun minuteur
 * ne « décompte » côté client.
 */
export function Countdown({ until, className = "" }: { until: string; className?: string }) {
  const remaining = useRemaining(until) ?? 0;
  return (
    <span
      role="timer"
      aria-label={spokenCountdown(remaining)}
      className={`font-mono tabular-nums ${className}`}
    >
      {formatCountdown(remaining)}
    </span>
  );
}
