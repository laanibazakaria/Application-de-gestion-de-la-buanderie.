"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { IconMute, IconSound } from "../ui/icons";

import {
  installAudioUnlockOnGesture,
  isAudioUnlocked,
  onAudioChange,
  playAlert,
  setSoundPreferred,
  soundPreferred,
  unlockAudio,
} from "./audio";

/** Bouton d'activation du son des alertes (le navigateur exige un geste). */
export function SoundToggle() {
  const t = useTranslations("alerts");
  const [on, setOn] = useState(false);

  useEffect(() => {
    const update = () => setOn(isAudioUnlocked() && soundPreferred());
    const off = onAudioChange(update);
    const uninstall = installAudioUnlockOnGesture();
    update();
    return () => {
      off();
      uninstall();
    };
  }, []);

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={async () => {
        if (on) {
          setSoundPreferred(false);
        } else {
          setSoundPreferred(true);
          if (await unlockAudio()) playAlert("info");
        }
      }}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold ${
        on ? "border-free text-free" : "border-waiting bg-waiting text-white"
      }`}
      title={t("soundHint")}
    >
      {on ? <IconSound /> : <IconMute />}
      <span>{on ? t("soundOn") : t("soundOff")}</span>
    </button>
  );
}
