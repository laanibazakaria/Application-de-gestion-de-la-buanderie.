"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { formatTime } from "@/lib/format";
import type { MyReservationView } from "@/lib/state-types";

import { Button } from "../ui/button";

import { Countdown } from "./countdown";
import { useLaundry } from "./laundry-provider";
import { WakeLockButton } from "./wake-lock-button";

/** « Ma réservation » : cycle en cours, appel avec « Je suis là », lancement, attente, annulation. */
export function MyReservation({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("mine");
  const { state } = useLaundry();
  const { reservations, cycle } = state.me;

  if (!cycle && reservations.length === 0) {
    if (compact) return null;
    return (
      <section className="border-line bg-surface rounded-xl border p-6 text-center shadow-sm">
        <p className="mb-4 text-lg">{t("none")}</p>
        <Link
          href="/"
          className="bg-accent text-accent-fg inline-flex min-h-11 items-center rounded-lg px-4 font-semibold"
        >
          {t("goDashboard")}
        </Link>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {cycle && (
        <section
          aria-labelledby="mon-cycle"
          className="border-line border-s-running bg-surface rounded-xl border border-s-8 p-4 shadow-sm"
          data-testid="my-cycle"
        >
          <h2 id="mon-cycle" className="text-lg font-bold">
            {t("cycleTitle")} — {t("cycleOn", { number: cycle.machineNumber })}
          </h2>
          <p className="text-muted text-sm">{t("cycleRemaining")}</p>
          <Countdown until={cycle.plannedEndAt} className="text-4xl font-bold" />
          <p className="text-muted text-sm">{t("cycleEnds", { time: formatTime(cycle.plannedEndAt) })}</p>
        </section>
      )}
      {reservations.map((r) => (
        <ReservationCard key={r.id} r={r} />
      ))}
    </div>
  );
}

function ReservationCard({ r }: { r: MyReservationView }) {
  const t = useTranslations("mine");
  const { state, act } = useLaundry();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const durations = state.settings.cycleDurationsMin;
  const machine = state.machines.find((m) => m.id === r.assignedMachineId);
  const [duration, setDuration] = useState<number>(
    durations.includes(machine?.defaultDurationMin ?? 0) ? machine!.defaultDurationMin : (durations[0] ?? 45),
  );

  async function run(path: string, body?: unknown) {
    setBusy(true);
    await act(path, body);
    setBusy(false);
  }

  const called = r.status === "called";
  const confirmed = r.status === "confirmed";
  const urgent = called || confirmed;

  return (
    <section
      aria-labelledby={`resa-${r.id}`}
      data-testid="my-reservation"
      data-status={r.status}
      className={`bg-surface rounded-xl border p-4 shadow-sm ${urgent ? "border-waiting border-4" : "border-line"}`}
    >
      <h2 id={`resa-${r.id}`} className={`font-bold ${urgent ? "text-2xl" : "text-lg"}`}>
        {called ? t("called") : confirmed ? t("confirmed") : t("waiting")}
      </h2>

      {called && (
        <>
          <p className="mt-1 text-lg">{t("calledOn", { number: r.assignedMachineNumber ?? "?" })}</p>
          <p className="text-muted mt-3 text-sm">{t("deadline")}</p>
          {r.deadlineAt && (
            <Countdown until={r.deadlineAt} className="text-waiting block text-5xl font-bold" />
          )}
          <Button
            size="lg"
            className="mt-4 w-full"
            disabled={busy}
            onClick={() => run(`/api/reservations/${r.id}/confirm`)}
          >
            {t("imHere")}
          </Button>
        </>
      )}

      {confirmed && (
        <>
          <p className="mt-1">{t("calledOn", { number: r.assignedMachineNumber ?? "?" })}</p>
          {state.settings.studentCanStartCycle ? (
            <>
              <p className="mt-1 text-sm">{t("confirmedHint")}</p>
              <p className="text-muted mt-3 text-sm">{t("startDeadline")}</p>
              {r.deadlineAt && (
                <Countdown until={r.deadlineAt} className="text-waiting block text-4xl font-bold" />
              )}
              <fieldset className="mt-3">
                <legend className="mb-2 font-semibold">{t("duration")}</legend>
                <div className="flex flex-wrap gap-2">
                  {durations.map((d) => (
                    <label
                      key={d}
                      className={`has-[:focus-visible]:outline-accent flex min-h-11 cursor-pointer items-center rounded-lg border px-4 font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-3 ${
                        d === duration ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface-2"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`duree-${r.id}`}
                        value={d}
                        checked={d === duration}
                        onChange={() => setDuration(d)}
                        className="sr-only"
                      />
                      {t("durationOption", { minutes: d })}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button
                size="lg"
                className="mt-4 w-full"
                disabled={busy || r.assignedMachineId === null}
                onClick={() => run("/api/cycles", { machineId: r.assignedMachineId, durationMin: duration })}
              >
                {t("start")}
              </Button>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm">{t("confirmedWaitAdmin")}</p>
              {r.deadlineAt && (
                <Countdown until={r.deadlineAt} className="text-waiting block text-4xl font-bold" />
              )}
            </>
          )}
        </>
      )}

      {r.status === "waiting" && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted">{t("machineTarget")}</dt>
          <dd className="font-semibold">
            {r.targetMachineNumber ? `Machine ${r.targetMachineNumber}` : t("anyMachine")}
          </dd>
          <dt className="text-muted">{t("position")}</dt>
          <dd className="text-2xl font-bold" data-testid="my-position">
            {r.position ?? "—"}
          </dd>
          <dt className="text-muted">{t("estimate")}</dt>
          <dd className="font-semibold">
            {r.estimatedAt
              ? t("estimateOn", { time: formatTime(r.estimatedAt), number: r.estimatedMachineNumber ?? "?" })
              : "—"}
          </dd>
        </dl>
      )}

      {r.notice === "machine_out_of_service" && (
        <div role="alert" className="bg-offline mt-3 rounded-lg p-3 text-white">
          <p>{t("noticeOutOfService", { number: r.targetMachineNumber ?? "?" })}</p>
          <Button
            variant="secondary"
            className="mt-2"
            disabled={busy}
            onClick={() => run(`/api/reservations/${r.id}/switch-to-any`)}
          >
            {t("switchAny")}
          </Button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!confirmCancel ? (
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmCancel(true)}>
            {t("cancel")}
          </Button>
        ) : (
          <>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => run(`/api/reservations/${r.id}/cancel`)}
              autoFocus
            >
              {t("cancelConfirm")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
              {t("cancelKeep")}
            </Button>
          </>
        )}
        <WakeLockButton />
      </div>
      <p className="text-muted mt-2 text-sm">{t("keepAwakeHint")}</p>
    </section>
  );
}
