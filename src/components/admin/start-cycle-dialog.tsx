"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import type { MachineView } from "@/lib/state-types";

import { useLaundry } from "../laundry/laundry-provider";
import { Button } from "../ui/button";

import { StudentPicker } from "./students";

/**
 * Démarrage d'un cycle par l'administrateur (fenêtre <dialog> native : focus piégé, Échap pour fermer).
 * - machine en attente : pour l'étudiant appelé (présence confirmée au passage) ;
 * - machine libre : lancement direct, l'administrateur choisit l'étudiant présent.
 */
export function StartCycleDialog({
  machine,
  studentName,
  onClose,
}: {
  machine: MachineView;
  studentName: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("admin.dialog");
  const { state, act } = useLaundry();
  const ref = useRef<HTMLDialogElement>(null);
  const presets = state.settings.cycleDurationsMin;
  const [duration, setDuration] = useState<number>(
    presets.includes(machine.defaultDurationMin) ? machine.defaultDurationMin : (presets[0] ?? 45),
  );
  const [studentId, setStudentId] = useState("");
  const [busy, setBusy] = useState(false);
  const needsStudent = machine.status === "free";

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`dlg-${machine.id}`}
      className="border-line bg-surface text-fg m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border p-0 backdrop:bg-black/60"
    >
      <form
        method="dialog"
        className="flex flex-col gap-4 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await act("/api/cycles", {
            machineId: machine.id,
            durationMin: duration,
            ...(needsStudent ? { studentId } : {}),
          });
          setBusy(false);
          if (ok) ref.current?.close();
        }}
      >
        <h2 id={`dlg-${machine.id}`} className="text-lg font-bold">
          {t("title", { name: machine.name })}
        </h2>
        {needsStudent ? (
          <div>
            <label htmlFor={`picker-${machine.id}`} className="mb-1 block font-semibold">
              {t("student")}
            </label>
            <StudentPicker id={`picker-${machine.id}`} value={studentId} onChange={setStudentId} />
          </div>
        ) : (
          <p>
            <span className="font-semibold">{t("student")} : </span>
            {studentName}
          </p>
        )}
        <fieldset>
          <legend className="mb-1 font-semibold">{t("duration")}</legend>
          <div className="flex flex-wrap gap-2">
            {presets.map((d) => (
              <label
                key={d}
                className={`flex min-h-10 cursor-pointer items-center rounded-lg border px-3 font-semibold ${d === duration ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface-2"}`}
              >
                <input
                  type="radio"
                  name="duree"
                  className="sr-only"
                  checked={d === duration}
                  onChange={() => setDuration(d)}
                />
                {d} min
              </label>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            {t("custom")}
            <input
              type="number"
              min={1}
              max={300}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="border-line bg-surface-2 min-h-10 w-24 rounded-lg border px-2"
            />
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => ref.current?.close()}>
            {t("close")}
          </Button>
          <Button
            type="submit"
            disabled={busy || (needsStudent && !studentId) || !(duration >= 1 && duration <= 300)}
          >
            {t("start")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
