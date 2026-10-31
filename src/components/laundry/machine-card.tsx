"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { formatTime } from "@/lib/format";
import type { MachineView, StudentRef } from "@/lib/state-types";

import { Button } from "../ui/button";

import { Countdown } from "./countdown";
import { useLaundry } from "./laundry-provider";
import { STATUS_STYLES, StatusBadge } from "./status-badge";

export function studentName(s: StudentRef | null): string | null {
  return s ? `${s.firstName} ${s.lastName}${s.room ? ` (ch. ${s.room})` : ""}` : null;
}

export function useCanReserve() {
  const { state } = useLaundry();
  const isStudent = state.viewer.role === "student";
  const blocked =
    !state.laundry.open ||
    state.me.cycle !== null ||
    state.me.reservations.length >= state.settings.maxActiveReservations;
  return isStudent && !blocked;
}

export function MachineCard({ machine, actions }: { machine: MachineView; actions?: React.ReactNode }) {
  const t = useTranslations("machine");
  const { state, act } = useLaundry();
  const [busy, setBusy] = useState(false);
  const canReserve = useCanReserve() && machine.status !== "out_of_service";
  const mine = machine.cycle?.isMine || machine.call?.isMine;
  const headingId = `machine-${machine.number}-titre`;

  async function reserve() {
    setBusy(true);
    await act("/api/reservations", { targetMachineId: machine.id });
    setBusy(false);
  }

  return (
    <article
      aria-labelledby={headingId}
      data-testid={`machine-${machine.number}`}
      data-status={machine.status}
      className={`border-line bg-surface flex flex-col gap-3 rounded-xl border border-s-8 p-4 shadow-sm ${STATUS_STYLES[machine.status].border} ${
        mine ? "ring-accent ring-2" : ""
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-bold">
          <span
            className="bg-surface-2 me-2 inline-flex size-8 items-center justify-center rounded-full text-base"
            aria-hidden
          >
            {machine.number}
          </span>
          {machine.name}
        </h2>
        <StatusBadge status={machine.status} />
      </header>

      {mine && <p className="text-accent text-sm font-semibold">{t("mine")}</p>}

      {machine.status === "running" && machine.cycle && (
        <div>
          <p className="text-muted text-sm">{t("remaining")}</p>
          <Countdown until={machine.cycle.plannedEndAt} className="text-3xl font-bold" />
          <p className="text-muted text-sm">
            {t("endsAt", { time: formatTime(machine.cycle.plannedEndAt) })}
          </p>
          {studentName(machine.cycle.student) && (
            <p className="text-sm">{studentName(machine.cycle.student)}</p>
          )}
        </div>
      )}

      {machine.status === "awaiting_student" && machine.call && (
        <div>
          <p className="text-muted text-sm">
            {machine.call.status === "confirmed" ? t("awaitingConfirmed") : t("awaitingDeadline")}
          </p>
          <Countdown until={machine.call.deadlineAt} className="text-3xl font-bold" />
          {studentName(machine.call.student) && (
            <p className="text-sm">{studentName(machine.call.student)}</p>
          )}
        </div>
      )}

      {machine.status === "out_of_service" && <p className="text-muted text-sm">{t("outOfService")}</p>}

      <section aria-label={t("queue")}>
        <h3 className="text-sm font-semibold">{t("queueCount", { count: machine.queue.length })}</h3>
        {machine.queue.length > 0 && (
          <ol className="mt-1 space-y-1 text-sm">
            {machine.queue.map((q) => (
              <li
                key={q.reservationId}
                className={`flex flex-wrap items-center gap-x-2 rounded-md px-2 py-1 ${q.isMine ? "bg-accent/15 font-semibold" : "bg-surface-2"}`}
              >
                <span className="tabular-nums">{t("position", { position: q.position })}</span>
                <span>{q.isMine ? t("you") : (studentName(q.student) ?? t("someone"))}</span>
                {q.isAny && <span className="border-line rounded border px-1 text-xs">{t("anyTag")}</span>}
                {q.student?.noShowWarning && (
                  <span className="bg-waiting rounded px-1 text-xs text-white">
                    ⚠ {q.student.noShowCount}
                  </span>
                )}
                <span className="text-muted ms-auto">
                  {q.estimatedAt ? t("estimate", { time: formatTime(q.estimatedAt) }) : t("noEstimate")}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="mt-auto flex flex-wrap items-center gap-2">
        {state.viewer.role === "student" && (
          <Button
            onClick={reserve}
            disabled={!canReserve || busy}
            aria-label={t("reserveLabel", { name: machine.name })}
          >
            {t("reserve")}
          </Button>
        )}
        {machine.newReservationEstimateAt && (
          <span className="text-muted text-sm">
            {t("nextAt", { time: formatTime(machine.newReservationEstimateAt) })}
          </span>
        )}
        {actions}
      </footer>
    </article>
  );
}
