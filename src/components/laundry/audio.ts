"use client";

/**
 * Alertes sonores avec Web Audio (aucun fichier à télécharger).
 * Les navigateurs bloquent le son tant que l'utilisateur n'a pas interagi avec la
 * page : le contexte audio est débloqué au premier geste (clic, touche, toucher).
 */
type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();
const PREF_KEY = "buanderie:son";

function getCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext ??
    null
  );
}

export function soundPreferred(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundPreferred(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    /* stockage indisponible (navigation privée) : préférence non mémorisée */
  }
  listeners.forEach((fn) => fn());
}

export function isAudioUnlocked(): boolean {
  return ctx?.state === "running";
}

/** À appeler depuis un geste de l'utilisateur. */
export async function unlockAudio(): Promise<boolean> {
  const Ctor = getCtor();
  if (!Ctor) return false;
  ctx ??= new Ctor();
  try {
    await ctx.resume();
  } catch {
    /* ignoré */
  }
  listeners.forEach((fn) => fn());
  return ctx.state === "running";
}

export function onAudioChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Débloque le son au premier geste, une seule fois. */
export function installAudioUnlockOnGesture(): () => void {
  const handler = () => {
    if (soundPreferred()) void unlockAudio();
  };
  const opts = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", handler, opts);
  window.addEventListener("keydown", handler, opts);
  return () => {
    window.removeEventListener("pointerdown", handler, opts);
    window.removeEventListener("keydown", handler, opts);
  };
}

/** Joue une série de bips (urgent = plus aigu et plus long). */
export function playAlert(kind: "urgent" | "info" = "urgent"): void {
  if (!ctx || ctx.state !== "running" || !soundPreferred()) return;
  const pattern = kind === "urgent" ? [0, 0.35, 0.7, 1.05] : [0, 0.3];
  const freq = kind === "urgent" ? 880 : 660;
  const start = ctx.currentTime + 0.05;
  for (const offset of pattern) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + offset);
    osc.stop(start + offset + 0.3);
  }
}

export function vibrate(kind: "urgent" | "info" = "urgent"): void {
  try {
    navigator.vibrate?.(kind === "urgent" ? [400, 150, 400, 150, 400] : [200]);
  } catch {
    /* non pris en charge (iOS) */
  }
}
