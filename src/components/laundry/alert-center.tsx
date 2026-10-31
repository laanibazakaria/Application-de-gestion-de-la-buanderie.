"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api-client";
import { formatTime } from "@/lib/format";

import { Button } from "../ui/button";
import { IconBell } from "../ui/icons";

import { playAlert, vibrate } from "./audio";
import { Countdown } from "./countdown";
import { useLaundry, useServerNow } from "./laundry-provider";

interface Alert {
  key: string;
  text: string;
  urgent: boolean;
  /** Réservation appelée : bouton « Je suis là » dans l'alerte. */
  confirmReservationId?: string;
  deadlineAt?: string | null;
}

const SEEN_KEY = "buanderie:alertes-vues";

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveSeen(seen: Set<string>) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-100)));
  } catch {
    /* stockage indisponible */
  }
}

/**
 * Alertes dans la page (remplacent les notifications push) :
 * bandeau (plein écran pour l'appel), son, vibration et titre de l'onglet qui clignote.
 *
 * Sources :
 *  - l'état (« appelé ») ;
 *  - des échéances connues à l'avance (1 minute avant l'expiration, fin de mon cycle),
 *    surveillées localement à partir des heures du serveur ;
 *  - les messages enregistrés par le serveur (expiration, fermeture, hors service…),
 *    affichés même si l'événement a eu lieu pendant que la page était fermée.
 */
export function AlertCenter() {
  const t = useTranslations("alerts");
  const tm = useTranslations("mine");
  const { state, act } = useLaundry();
  const now = useServerNow();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const markedUpTo = useRef(0);
  const primaryButton = useRef<HTMLButtonElement | null>(null);

  const machineNumber = useCallback(
    (id: unknown) => state.machines.find((m) => m.id === id)?.number ?? "?",
    [state.machines],
  );

  const raise = useCallback((alert: Alert) => {
    seen.current ??= loadSeen();
    if (seen.current.has(alert.key)) return;
    seen.current.add(alert.key);
    saveSeen(seen.current);
    // Une nouvelle alerte pour la même réservation (ex. : « plus qu'une minute ») remplace la précédente.
    setAlerts((list) => [
      ...list.filter(
        (a) =>
          a.key !== alert.key &&
          !(alert.confirmReservationId && a.confirmReservationId === alert.confirmReservationId),
      ),
      alert,
    ]);
    playAlert(alert.urgent ? "urgent" : "info");
    vibrate(alert.urgent ? "urgent" : "info");
  }, []);

  const dismiss = (key: string) => setAlerts((list) => list.filter((a) => a.key !== key));

  // Étudiants seulement.
  const isStudent = state.viewer.role === "student";

  // 1) Appel et avertissement « plus qu'une minute ».
  useEffect(() => {
    if (!isStudent) return;
    for (const r of state.me.reservations) {
      if (r.status === "called") {
        raise({
          key: `appel:${r.id}:${r.calledAt}`, // un nouvel appel de la même réservation (après une panne) réalerte
          text: t("called", { number: r.assignedMachineNumber ?? "?", time: formatTime(r.deadlineAt) }),
          urgent: true,
          confirmReservationId: r.id,
          deadlineAt: r.deadlineAt,
        });
      }
      if ((r.status === "called" || r.status === "confirmed") && r.deadlineAt) {
        const remaining = Date.parse(r.deadlineAt) - now;
        if (remaining > 0 && remaining <= 60_000) {
          raise({
            key: `minute:${r.id}:${r.status}:${r.deadlineAt}`,
            text: t(r.status === "called" ? "oneMinute" : "oneMinuteStart", {
              number: r.assignedMachineNumber ?? "?",
            }),
            urgent: true,
            confirmReservationId: r.status === "called" ? r.id : undefined,
            deadlineAt: r.deadlineAt,
          });
        }
      }
    }
    // Les alertes d'appel disparaissent dès que la réservation n'est plus « appelée ».
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronisation avec l'état du serveur
    setAlerts((list) =>
      list.filter(
        (a) =>
          !a.confirmReservationId ||
          state.me.reservations.some((r) => r.id === a.confirmReservationId && r.status === "called"),
      ),
    );
  }, [isStudent, state.me.reservations, now, raise, t]);

  // 2) Fin de mon cycle, détectée localement à l'heure prévue.
  const cycle = state.me.cycle;
  useEffect(() => {
    if (!isStudent || !cycle) return;
    if (Date.parse(cycle.plannedEndAt) <= now) {
      raise({
        key: `fin:${cycle.id}`,
        text: t("cycle_finished", { number: cycle.machineNumber }),
        urgent: false,
      });
    }
  }, [isStudent, cycle, now, raise, t]);

  // 3) Messages du serveur (une fois affichés, ils sont marqués comme lus).
  useEffect(() => {
    if (!isStudent) return;
    const notes = state.me.notifications;
    if (notes.length === 0) return;
    for (const n of notes) {
      if (n.kind === "called") continue; // déjà couvert par l'état
      const key = n.kind === "cycle_finished" ? `fin:${String(n.details.cycleId)}` : `msg:${n.id}`;
      const text = t.has(n.kind) ? t(n.kind, { number: machineNumber(n.details.machineId) }) : n.kind;
      raise({ key, text, urgent: n.kind.startsWith("expired") });
    }
    const maxId = Math.max(...notes.map((n) => n.id));
    if (maxId > markedUpTo.current) {
      markedUpTo.current = maxId;
      void api("/api/notifications/read", { body: { upToId: maxId } });
    }
  }, [isStudent, state.me.notifications, raise, t, machineNumber]);

  // Titre de l'onglet qui clignote tant qu'une alerte est affichée.
  const flashing = alerts.length > 0;
  const urgentCall = alerts.some((a) => a.confirmReservationId);
  useEffect(() => {
    if (!flashing) return;
    const original = document.title;
    const flash = urgentCall ? t("titleFlash") : t("titleFlashGeneric");
    let on = false;
    const timer = setInterval(() => {
      on = !on;
      document.title = on ? flash : original;
    }, 1000);
    return () => {
      clearInterval(timer);
      document.title = original;
    };
  }, [flashing, urgentCall, t]);

  // L'alerte d'appel prend le focus (clavier, lecteur d'écran).
  const callAlert = useMemo(() => alerts.find((a) => a.confirmReservationId), [alerts]);
  useEffect(() => {
    if (callAlert) primaryButton.current?.focus();
  }, [callAlert]);

  if (alerts.length === 0) return null;
  const others = alerts.filter((a) => a !== callAlert);

  return (
    <>
      {callAlert && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          data-testid="call-alert"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="alerte-appel"
            className="bg-waiting w-full max-w-md rounded-2xl p-6 text-center text-white shadow-2xl"
          >
            <IconBell width={48} height={48} className="mx-auto mb-2 animate-bounce" />
            <h2 id="alerte-appel" className="text-2xl font-extrabold">
              {callAlert.text}
            </h2>
            {callAlert.deadlineAt && (
              <Countdown until={callAlert.deadlineAt} className="mt-3 block text-6xl font-extrabold" />
            )}
            <Button
              ref={primaryButton}
              size="lg"
              variant="secondary"
              className="mt-5 w-full text-xl"
              onClick={async () => {
                const id = callAlert.confirmReservationId!;
                if (await act(`/api/reservations/${id}/confirm`)) dismiss(callAlert.key);
              }}
            >
              {tm("imHere")}
            </Button>
            <button type="button" className="mt-3 text-sm underline" onClick={() => dismiss(callAlert.key)}>
              {t("dismiss")}
            </button>
          </div>
        </div>
      )}
      {others.length > 0 && (
        <div className="sticky top-0 z-30 flex flex-col gap-2 p-2">
          {others.map((a) => (
            <div
              key={a.key}
              role="alert"
              className={`flex items-start gap-3 rounded-xl p-4 shadow-lg ${a.urgent ? "bg-running text-white" : "bg-accent text-accent-fg"}`}
            >
              <IconBell className="mt-0.5 shrink-0" />
              <p className="flex-1 font-semibold">{a.text}</p>
              <button
                type="button"
                className="min-h-9 rounded-md border border-current px-3 text-sm font-semibold"
                onClick={() => dismiss(a.key)}
              >
                {t("dismiss")}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
