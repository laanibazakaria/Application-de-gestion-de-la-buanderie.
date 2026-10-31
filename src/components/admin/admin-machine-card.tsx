"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { formatTime } from "@/lib/format";
import type { MachineView } from "@/lib/state-types";

import { Countdown } from "../laundry/countdown";
import { useLaundry } from "../laundry/laundry-provider";
import { studentName } from "../laundry/machine-card";
import { STATUS_STYLES, StatusBadge } from "../laundry/status-badge";
import { Button } from "../ui/button";
import { ConfirmButton } from "../ui/confirm-button";

import { SortableQueue } from "./sortable-queue";
import { StartCycleDialog } from "./start-cycle-dialog";
import { StudentPicker } from "./students";

export function AdminMachineCard({ machine }: { machine: MachineView }) {
  const t = useTranslations("admin.pilot");
  const tm = useTranslations("machine");
  const { act } = useLaundry();
  const [dialog, setDialog] = useState(false);
  const [adding, setAdding] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [target, setTarget] = useState<"machine" | "any">("machine");
  const { cycle, call } = machine;
  const callName = studentName(call?.student ?? null);

  return (
    <article
      aria-labelledby={`adm-m${machine.number}`}
      data-testid={`admin-machine-${machine.number}`}
      data-status={machine.status}
      className={`border-line bg-surface flex flex-col gap-3 rounded-xl border border-s-8 p-4 shadow-sm ${STATUS_STYLES[machine.status].border}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`adm-m${machine.number}`} className="text-lg font-bold">
          {machine.number}. {machine.name}
        </h2>
        <StatusBadge status={machine.status} />
      </header>

      {machine.status === "running" && cycle && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{t("runningFor", { name: studentName(cycle.student) ?? "?" })}</p>
          <p>
            <Countdown until={cycle.plannedEndAt} className="text-3xl font-bold" />{" "}
            <span className="text-muted text-sm">
              {tm("endsAt", { time: formatTime(cycle.plannedEndAt) })}
            </span>
          </p>
          <div className="flex flex-wrap gap-1">
            {[5, 10, 15].map((m) => (
              <Button
                key={m}
                size="sm"
                variant="secondary"
                aria-label={t("extendLabel", { minutes: m })}
                onClick={() => act(`/api/admin/cycles/${cycle.id}/extend`, { minutes: m })}
              >
                {t("extend", { minutes: m })}
              </Button>
            ))}
            <ConfirmButton
              confirmLabel={t("endEarlyConfirm")}
              onConfirm={() => act(`/api/admin/cycles/${cycle.id}/stop`, { mode: "ended_early" })}
            >
              {t("endEarly")}
            </ConfirmButton>
            <ConfirmButton
              confirmLabel={t("cancelCycleConfirm")}
              onConfirm={() => act(`/api/admin/cycles/${cycle.id}/stop`, { mode: "cancelled" })}
            >
              {t("cancelCycle")}
            </ConfirmButton>
          </div>
        </div>
      )}

      {machine.status === "awaiting_student" && call && (
        <div className="flex flex-col gap-2">
          <p className="font-semibold">
            {call.status === "called"
              ? t("calledStudent", { name: callName ?? "?" })
              : t("confirmedStudent", { name: callName ?? "?" })}
            {call.student?.noShowWarning && (
              <span className="bg-waiting ms-2 rounded px-1 text-xs text-white">
                ⚠ {t("noShowWarning", { count: call.student.noShowCount ?? 0 })}
              </span>
            )}
          </p>
          <Countdown until={call.deadlineAt} className="text-3xl font-bold" />
          <div className="flex flex-wrap gap-1">
            {call.status === "called" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => act(`/api/reservations/${call.reservationId}/confirm`)}
              >
                {t("confirmPresence")}
              </Button>
            )}
            <Button size="sm" onClick={() => setDialog(true)}>
              {t("startFor", { name: call.student?.firstName ?? "" })}
            </Button>
          </div>
        </div>
      )}

      {machine.status === "free" && (
        <div>
          <Button size="sm" onClick={() => setDialog(true)}>
            {t("startCycle")}
          </Button>
        </div>
      )}

      <section aria-label={t("queue")} className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{tm("queueCount", { count: machine.queue.length })}</h3>
        <SortableQueue machineId={machine.id} queue={machine.queue} />
        {!adding ? (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setAdding(true)}>
            + {t("addStudent")}
          </Button>
        ) : (
          <form
            className="border-line flex flex-col gap-2 rounded-lg border p-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await act("/api/admin/queue", {
                studentId,
                targetMachineId: target === "any" ? null : machine.id,
              });
              if (ok) {
                setAdding(false);
                setStudentId("");
              }
            }}
          >
            <StudentPicker id={`add-${machine.id}`} value={studentId} onChange={setStudentId} />
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="sr-only">{t("addTo")}</legend>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name={`cible-${machine.id}`}
                  checked={target === "machine"}
                  onChange={() => setTarget("machine")}
                />
                {t("addThisMachine")}
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name={`cible-${machine.id}`}
                  checked={target === "any"}
                  onChange={() => setTarget("any")}
                />
                {t("addAny")}
              </label>
            </fieldset>
            <div className="flex gap-1">
              <Button
                size="sm"
                type="submit"
                disabled={!studentId || (machine.status === "out_of_service" && target === "machine")}
              >
                {t("add")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                ✕<span className="sr-only">Annuler</span>
              </Button>
            </div>
          </form>
        )}
      </section>

      <footer className="border-line mt-auto border-t pt-2">
        {machine.status === "out_of_service" ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => act(`/api/admin/machines/${machine.id}/enable`)}
          >
            {t("enable")}
          </Button>
        ) : (
          machine.status !== "running" && (
            <ConfirmButton
              confirmLabel={t("disableConfirm")}
              onConfirm={() => act(`/api/admin/machines/${machine.id}/disable`)}
            >
              {t("disable")}
            </ConfirmButton>
          )
        )}
      </footer>

      {dialog && (
        <StartCycleDialog machine={machine} studentName={callName} onClose={() => setDialog(false)} />
      )}
    </article>
  );
}
