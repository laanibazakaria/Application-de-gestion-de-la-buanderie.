"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { api } from "@/lib/api-client";

import { useToast } from "../laundry/toasts";
import { Button } from "../ui/button";

interface SettingsData {
  callDelayMin: number;
  confirmDelayMin: number;
  cycleDurationsMin: number[];
  maxActiveReservations: number;
  studentCanStartCycle: boolean;
  noShowWarningThreshold: number;
  noShowWindowDays: number;
}
interface HoursRow {
  weekday: number;
  isOpen: boolean;
  openMinute: number;
  closeMinute: number;
}
interface MachineRow {
  id: number;
  number: number;
  name: string;
  defaultDurationMin: number;
}

/** Minutes depuis minuit ↔ « HH:MM ». 1440 (fin de journée) s'affiche « 00:00 ». */
export function toHHMM(minutes: number): string {
  const m = minutes % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export function fromHHMM(value: string, isClose: boolean): number {
  const [h, m] = value.split(":").map(Number);
  const minutes = (h ?? 0) * 60 + (m ?? 0);
  return isClose && minutes === 0 ? 1440 : minutes;
}

const input = "min-h-10 rounded-lg border border-line bg-surface-2 px-3";

export function SettingsForm({
  initial,
  initialHours,
  machines,
}: {
  initial: SettingsData;
  initialHours: HoursRow[];
  machines: MachineRow[];
}) {
  const t = useTranslations("admin.settings");
  const te = useTranslations("errors");
  const toast = useToast();
  const [hours, setHours] = useState(initialHours);
  const [busy, setBusy] = useState(false);
  const weekdays = t.raw("weekdays") as string[];

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const durations = String(f.get("durations"))
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map(Number);
    if (
      durations.length === 0 ||
      durations.some((d) => !Number.isInteger(d) || d < 5 || d > 300) ||
      new Set(durations).size !== durations.length
    ) {
      toast.push("error", t("invalidDurations"));
      return;
    }
    const settings: SettingsData = {
      callDelayMin: Number(f.get("callDelayMin")),
      confirmDelayMin: Number(f.get("confirmDelayMin")),
      cycleDurationsMin: durations,
      maxActiveReservations: Number(f.get("maxActiveReservations")),
      studentCanStartCycle: f.get("studentCanStartCycle") === "on",
      noShowWarningThreshold: Number(f.get("noShowWarningThreshold")),
      noShowWindowDays: Number(f.get("noShowWindowDays")),
    };
    setBusy(true);
    const res = await api("/api/admin/settings", { method: "PUT", body: { settings, hours } });
    let ok = res.ok;
    if (!res.ok) toast.push("error", te.has(res.code) ? te(res.code) : te("INVALID_INPUT"));
    // Machines : seulement celles qui ont changé.
    for (const m of machines) {
      const name = String(f.get(`name-${m.id}`)).trim();
      const duration = Number(f.get(`duration-${m.id}`));
      if (name !== m.name || duration !== m.defaultDurationMin) {
        const r = await api(`/api/admin/machines/${m.id}`, {
          method: "PATCH",
          body: { name, defaultDurationMin: duration },
        });
        if (!r.ok) {
          ok = false;
          toast.push("error", te.has(r.code) ? te(r.code) : te("INVALID_INPUT"));
        }
      }
    }
    setBusy(false);
    if (ok) toast.push("success", t("saved"));
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <section aria-labelledby="p-general" className="border-line bg-surface rounded-xl border p-4">
        <h2 id="p-general" className="mb-3 text-lg font-bold">
          {t("general")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["callDelayMin", t("callDelay"), initial.callDelayMin, 1, 60],
              ["confirmDelayMin", t("confirmDelay"), initial.confirmDelayMin, 1, 60],
              ["maxActiveReservations", t("maxActive"), initial.maxActiveReservations, 1, 5],
              ["noShowWarningThreshold", t("noShowThreshold"), initial.noShowWarningThreshold, 1, 50],
              ["noShowWindowDays", t("noShowWindow"), initial.noShowWindowDays, 1, 365],
            ] as const
          ).map(([name, label, value, min, max]) => (
            <label key={name} className="flex flex-col gap-1 text-sm font-semibold">
              {label}
              <input
                name={name}
                type="number"
                min={min}
                max={max}
                defaultValue={value}
                required
                className={input}
              />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {t("durations")}
            <input
              name="durations"
              defaultValue={initial.cycleDurationsMin.join(", ")}
              required
              className={input}
              inputMode="numeric"
            />
          </label>
          <label className="flex items-center gap-2 font-semibold sm:col-span-2">
            <input
              name="studentCanStartCycle"
              type="checkbox"
              defaultChecked={initial.studentCanStartCycle}
              className="size-5"
            />
            {t("studentCanStart")}
          </label>
        </div>
      </section>

      <section aria-labelledby="p-horaires" className="border-line bg-surface rounded-xl border p-4">
        <h2 id="p-horaires" className="mb-1 text-lg font-bold">
          {t("hours")}
        </h2>
        <p className="text-muted mb-3 text-sm">{t("midnightHint")}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-start">
              <th scope="col" className="py-1 text-start">
                {t("day")}
              </th>
              <th scope="col" className="text-start">
                {t("open")}
              </th>
              <th scope="col" className="text-start">
                {t("opensAt")}
              </th>
              <th scope="col" className="text-start">
                {t("closesAt")}
              </th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h, i) => {
              const update = (patch: Partial<HoursRow>) =>
                setHours((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const day = weekdays[h.weekday - 1];
              return (
                <tr key={h.weekday} className="border-line border-t">
                  <th scope="row" className="py-2 text-start font-semibold">
                    {day}
                  </th>
                  <td>
                    <input
                      type="checkbox"
                      checked={h.isOpen}
                      onChange={(e) => update({ isOpen: e.target.checked })}
                      aria-label={`${t("open")} — ${day}`}
                      className="size-5"
                    />
                  </td>
                  <td>
                    <input
                      type="time"
                      step={300}
                      value={toHHMM(h.openMinute)}
                      disabled={!h.isOpen}
                      onChange={(e) => update({ openMinute: fromHHMM(e.target.value, false) })}
                      aria-label={`${t("opensAt")} — ${day}`}
                      className={input}
                    />
                  </td>
                  <td>
                    <input
                      type="time"
                      step={300}
                      value={toHHMM(h.closeMinute)}
                      disabled={!h.isOpen}
                      onChange={(e) => update({ closeMinute: fromHHMM(e.target.value, true) })}
                      aria-label={`${t("closesAt")} — ${day}`}
                      className={input}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="p-machines" className="border-line bg-surface rounded-xl border p-4">
        <h2 id="p-machines" className="mb-3 text-lg font-bold">
          {t("machines")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {machines.map((m) => (
            <fieldset key={m.id} className="border-line flex flex-wrap items-end gap-2 rounded-lg border p-2">
              <legend className="px-1 text-sm font-semibold">#{m.number}</legend>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                {t("machineName")}
                <input
                  name={`name-${m.id}`}
                  defaultValue={m.name}
                  required
                  maxLength={40}
                  className={input}
                />
              </label>
              <label className="flex w-32 flex-col gap-1 text-sm">
                {t("machineDuration")}
                <input
                  name={`duration-${m.id}`}
                  type="number"
                  min={1}
                  max={300}
                  defaultValue={m.defaultDurationMin}
                  required
                  className={input}
                />
              </label>
            </fieldset>
          ))}
        </div>
      </section>

      <Button type="submit" size="lg" disabled={busy} className="self-start">
        {t("save")}
      </Button>
    </form>
  );
}
