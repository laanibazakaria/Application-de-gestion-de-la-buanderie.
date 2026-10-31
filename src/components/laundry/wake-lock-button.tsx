"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";

type Sentinel = { release: () => Promise<void>; addEventListener: (t: "release", fn: () => void) => void };
type WakeLockNav = Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } };

/**
 * « Garder l'écran allumé » (API Screen Wake Lock, Safari 16.4+ et Chrome) :
 * sans notification push, la page doit rester affichée pour prévenir l'étudiant.
 */
export function WakeLockButton() {
  const t = useTranslations("mine");
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const wanted = useRef(false);
  const sentinel = useRef<Sentinel | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- détection d'une API du navigateur après le montage
    setSupported(!!(navigator as WakeLockNav).wakeLock);
    const onVisible = () => {
      if (document.visibilityState === "visible" && wanted.current && !sentinel.current) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel.current?.release();
    };
  }, []);

  async function acquire() {
    try {
      const s = await (navigator as WakeLockNav).wakeLock!.request("screen");
      sentinel.current = s;
      setActive(true);
      s.addEventListener("release", () => {
        sentinel.current = null;
        setActive(false);
      });
    } catch {
      setActive(false);
    }
  }

  if (!supported) return null;
  return (
    <Button
      variant="secondary"
      aria-pressed={active}
      onClick={() => {
        wanted.current = !active;
        if (active) void sentinel.current?.release();
        else void acquire();
      }}
    >
      {active ? `✓ ${t("keepAwakeOn")}` : t("keepAwake")}
    </Button>
  );
}
