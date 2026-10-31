"use client";

import { useState, type ReactNode } from "react";

import { Button } from "./button";

/** Action destructive en deux temps : un premier clic demande confirmation (pas de fenêtre modale). */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  variant = "secondary",
  size = "sm",
  disabled,
  ariaLabel,
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<unknown> | void;
  variant?: "secondary" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setAsking(true)}
      >
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Button
        variant="danger"
        size={size}
        autoFocus
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onConfirm();
          setBusy(false);
          setAsking(false);
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" size={size} onClick={() => setAsking(false)}>
        ✕<span className="sr-only">Annuler</span>
      </Button>
    </span>
  );
}
