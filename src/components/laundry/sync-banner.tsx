"use client";

import { useTranslations } from "next-intl";

import { useLaundry } from "./laundry-provider";

/** Bandeau visible quand l'état n'est plus synchronisé (hors ligne, erreur). */
export function SyncBanner() {
  const t = useTranslations("sync");
  const { status } = useLaundry();
  if (status !== "offline" && status !== "error") return null;
  return (
    <div
      role="status"
      data-testid="sync-banner"
      className="bg-offline px-4 py-2 text-center text-sm font-semibold text-white"
    >
      {t(status)}
    </div>
  );
}
