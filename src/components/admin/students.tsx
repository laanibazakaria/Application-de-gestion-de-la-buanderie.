"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api-client";

export interface StudentOption {
  id: string;
  firstName: string;
  lastName: string;
  room: string | null;
  schoolId: string;
  status: "active" | "suspended";
  noShowWarning: boolean;
  noShowCount: number;
}

let cache: Promise<StudentOption[]> | null = null;

/** Liste des étudiants actifs (chargée une fois par page, à la demande). */
export function useStudents(enabled: boolean): StudentOption[] | null {
  const [list, setList] = useState<StudentOption[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    cache ??= api<{ users: StudentOption[] }>("/api/admin/users?role=student", { method: "GET" }).then((r) =>
      r.ok ? r.data.users.filter((u) => u.status === "active") : [],
    );
    let alive = true;
    void cache.then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return list;
}

export function invalidateStudents() {
  cache = null;
}

/** Choix d'un étudiant : champ de recherche + liste déroulante (accessible au clavier). */
export function StudentPicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (id: string) => void;
  id: string;
}) {
  const t = useTranslations("admin.picker");
  const students = useStudents(true);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (students ?? []).filter(
      (s) =>
        !needle ||
        `${s.firstName} ${s.lastName} ${s.room ?? ""} ${s.schoolId}`.toLowerCase().includes(needle),
    );
  }, [students, q]);
  return (
    <div className="flex flex-col gap-1">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("search")}
        aria-label={t("search")}
        className="border-line bg-surface-2 min-h-10 rounded-lg border px-3"
      />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-line bg-surface-2 min-h-10 rounded-lg border px-2"
        aria-label={t("choose")}
      >
        <option value="">
          {students === null ? t("loading") : filtered.length ? t("choose") : t("none")}
        </option>
        {filtered.map((s) => (
          <option key={s.id} value={s.id}>
            {s.lastName} {s.firstName} — {s.room ?? "?"} ({s.schoolId})
            {s.noShowWarning ? ` ⚠ ${s.noShowCount}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
