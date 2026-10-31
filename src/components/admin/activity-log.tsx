"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

import { Button } from "../ui/button";

interface Entry {
  id: number;
  at: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  actorName: string | null;
  actorRole: string | null;
}

const GROUPS = [
  "reservation.",
  "queue.",
  "cycle.",
  "machine.",
  "user.",
  "auth.",
  "settings.",
  "opening_hours.",
] as const;

/** Résumé lisible des détails d'une entrée (machine, durée…). */
function summarize(e: Entry): string {
  const d = e.details;
  const parts: string[] = [];
  if (typeof d.machineId === "number") parts.push(`Machine ${d.machineId}`);
  if (typeof d.targetMachineId === "number") parts.push(`Machine ${d.targetMachineId}`);
  if (d.targetMachineId === null && e.action.endsWith("created")) parts.push("1re dispo");
  if (typeof d.durationMin === "number") parts.push(`${d.durationMin} min`);
  if (typeof d.minutes === "number") parts.push(`+${d.minutes} min`);
  if (typeof d.count === "number") parts.push(`${d.count}`);
  if (typeof d.schoolId === "string") parts.push(d.schoolId);
  if (e.entityType === "machine" && parts.length === 0) parts.push(`Machine ${e.entityId}`);
  return parts.join(" · ");
}

export function ActivityLog() {
  const t = useTranslations("admin.activity");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (beforeId?: number) => {
      setLoading(true);
      const params = new URLSearchParams({ limit: "50" });
      if (beforeId) params.set("beforeId", String(beforeId));
      if (filter) params.set("action", filter);
      const res = await api<{ entries: Entry[]; nextBeforeId: number | null }>(
        `/api/admin/activity?${params}`,
        { method: "GET" },
      );
      if (res.ok) {
        setEntries((list) => (beforeId ? [...list, ...res.data.entries] : res.data.entries));
        setNext(res.data.nextBeforeId);
      }
      setLoading(false);
    },
    [filter],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement à chaque changement de filtre
    void load();
  }, [load]);

  // Les clés de traduction ne peuvent pas contenir de point (séparateur de niveaux) : « cycle.started » → « cycle_started ».
  const label = (action: string) => {
    const key = `actions.${action.replaceAll(".", "_")}`;
    return t.has(key) ? t(key) : action;
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex max-w-xs flex-col gap-1 text-sm font-semibold">
        {t("filter")}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border-line bg-surface-2 min-h-10 rounded-lg border px-2"
        >
          <option value="">{t("all")}</option>
          {GROUPS.map((g) => (
            <option key={g} value={g}>
              {t(`groups.${g.slice(0, -1)}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="border-line bg-surface overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="p-2 text-start">
                {t("when")}
              </th>
              <th scope="col" className="p-2 text-start">
                {t("who")}
              </th>
              <th scope="col" className="p-2 text-start">
                {t("what")}
              </th>
              <th scope="col" className="p-2 text-start">
                {t("details")}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-line border-t align-top">
                <td className="p-2 whitespace-nowrap tabular-nums">{formatDateTime(e.at)}</td>
                <td className="p-2">{e.actorName ?? <span className="text-muted">{t("system")}</span>}</td>
                <td className="p-2 font-semibold">{label(e.action)}</td>
                <td className="text-muted p-2">{summarize(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && !loading && <p className="text-muted p-4">{t("empty")}</p>}
      </div>
      {next && (
        <Button variant="secondary" className="self-start" disabled={loading} onClick={() => load(next)}>
          {t("more")}
        </Button>
      )}
    </div>
  );
}
