"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { api } from "@/lib/api-client";
import { csvField } from "@/lib/csv";

import { useToast } from "../laundry/toasts";
import { Button } from "../ui/button";
import { ConfirmButton } from "../ui/confirm-button";

import { invalidateStudents } from "./students";

interface UserRow {
  id: string;
  role: "admin" | "student";
  schoolId: string;
  firstName: string;
  lastName: string;
  room: string | null;
  status: "active" | "suspended";
  mustChangePassword: boolean;
  noShowCount: number;
  noShowWarning: boolean;
}

interface Credential {
  schoolId: string;
  firstName: string;
  lastName: string;
  room: string | null;
  temporaryPassword: string;
}

const input = "min-h-10 rounded-lg border border-line bg-surface-2 px-3";

export function Accounts({ noShowWindowDays, selfId }: { noShowWindowDays: number; selfId: string }) {
  const t = useTranslations("admin.accounts");
  const te = useTranslations("errors");
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [role, setRole] = useState<"student" | "admin">("student");
  const [q, setQ] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [importErrors, setImportErrors] = useState<Array<{ line: number; message: string }>>([]);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ users: UserRow[] }>("/api/admin/users", { method: "GET" });
    if (res.ok) setUsers(res.data.users);
    invalidateStudents();
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial
    void load();
  }, [load]);

  const fail = (code: string) => toast.push("error", te.has(code) ? te(code) : te("INTERNAL"));

  async function post(path: string, body?: unknown, method?: string) {
    const res = await api<Record<string, unknown>>(path, { body, method });
    if (!res.ok) fail(res.code);
    await load();
    return res;
  }

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (users ?? [])
      .filter((u) => u.role === role)
      .filter(
        (u) =>
          !needle ||
          `${u.firstName} ${u.lastName} ${u.room ?? ""} ${u.schoolId}`.toLowerCase().includes(needle),
      );
  }, [users, role, q]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    const body = {
      role: String(f.get("role")),
      schoolId: String(f.get("schoolId")),
      firstName: String(f.get("firstName")),
      lastName: String(f.get("lastName")),
      room: String(f.get("room") ?? "") || null,
    };
    const res = await post("/api/admin/users", body);
    if (res.ok) {
      setSecret(
        t("tempPassword", {
          name: `${body.firstName} ${body.lastName}`,
          password: String(res.data.temporaryPassword),
        }),
      );
      formEl.reset();
    }
  }

  async function importCsv(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get("file");
    const csv = file instanceof File && file.size > 0 ? await file.text() : String(f.get("csv") ?? "");
    const res = await api<{ created: Credential[]; errors: Array<{ line: number; message: string }> }>(
      "/api/admin/users/import",
      { body: { csv } },
    );
    if (res.ok) {
      setImportErrors([]);
      setCredentials(res.data.created);
      toast.push("success", t("importDone", { count: res.data.created.length }));
    } else {
      const data = res.data as { errors?: Array<{ line: number; message: string }> } | undefined;
      if (data?.errors) setImportErrors(data.errors);
      else fail(res.code);
    }
    await load();
  }

  function downloadCredentials() {
    const lines = [
      "nom;prénom;chambre;identifiant;mot de passe temporaire",
      ...credentials.map((c) =>
        [c.lastName, c.firstName, c.room ?? "", c.schoolId, c.temporaryPassword].map(csvField).join(";"),
      ),
    ];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "identifiants-buanderie.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="flex flex-col gap-6">
      {secret && (
        <div role="status" className="border-free bg-surface rounded-xl border-2 p-4">
          <p className="text-lg font-bold" data-testid="temp-password">
            {secret}
          </p>
          <p className="text-muted text-sm">{t("tempPasswordHint")}</p>
          <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
            ✕<span className="sr-only">Fermer</span>
          </Button>
        </div>
      )}

      <section aria-labelledby="liste-comptes" className="border-line bg-surface rounded-xl border p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 id="liste-comptes" className="me-auto text-lg font-bold">
            {role === "student" ? t("students") : t("admins")}
          </h2>
          <div role="group" className="border-line flex rounded-lg border">
            {(["student", "admin"] as const).map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={role === r}
                onClick={() => setRole(r)}
                className={`min-h-10 px-3 text-sm font-semibold ${role === r ? "bg-fg text-bg" : ""}`}
              >
                {r === "student" ? t("students") : t("admins")}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
            className={input}
          />
        </div>
        {visible.length === 0 ? (
          <p className="text-muted">{users === null ? "…" : t("empty")}</p>
        ) : (
          <ul className="divide-line divide-y">
            {visible.map((u) => (
              <li
                key={u.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center"
                data-testid="account-row"
              >
                {editing === u.id ? (
                  <form
                    className="flex flex-1 flex-wrap gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      const res = await post(
                        `/api/admin/users/${u.id}`,
                        {
                          firstName: String(f.get("firstName")),
                          lastName: String(f.get("lastName")),
                          room: String(f.get("room") ?? "") || null,
                        },
                        "PATCH",
                      );
                      if (res.ok) setEditing(null);
                    }}
                  >
                    <input
                      name="firstName"
                      defaultValue={u.firstName}
                      aria-label={t("firstName")}
                      className={input}
                      required
                    />
                    <input
                      name="lastName"
                      defaultValue={u.lastName}
                      aria-label={t("lastName")}
                      className={input}
                      required
                    />
                    <input
                      name="room"
                      defaultValue={u.room ?? ""}
                      aria-label={t("room")}
                      className={`${input} w-24`}
                    />
                    <Button size="sm" type="submit">
                      {t("save")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      {t("cancel")}
                    </Button>
                  </form>
                ) : (
                  <div className="flex-1">
                    <p className="font-semibold">
                      {u.lastName} {u.firstName}
                      {u.room && (
                        <span className="text-muted font-normal">
                          {" "}
                          · {t("room")} {u.room}
                        </span>
                      )}
                    </p>
                    <p className="text-muted flex flex-wrap gap-2 text-sm">
                      <span>{u.schoolId}</span>
                      <span className={u.status === "active" ? "text-free" : "text-running font-semibold"}>
                        {u.status === "active" ? t("active") : t("suspended")}
                      </span>
                      {u.mustChangePassword && <span>· {t("mustChange")}</span>}
                      {u.role === "student" && (
                        <span title={t("noShows", { days: noShowWindowDays })}>
                          {u.noShowWarning ? (
                            <strong className="bg-waiting rounded px-1 text-white">
                              {t("warning", { count: u.noShowCount })}
                            </strong>
                          ) : (
                            `· ${t("noShows", { days: noShowWindowDays })} : ${u.noShowCount}`
                          )}
                        </span>
                      )}
                    </p>
                  </div>
                )}
                {editing !== u.id && u.id !== selfId && (
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u.id)}>
                      {t("edit")}
                    </Button>
                    <ConfirmButton
                      confirmLabel={t("resetConfirm")}
                      onConfirm={async () => {
                        const res = await post(`/api/admin/users/${u.id}/reset-password`);
                        if (res.ok)
                          setSecret(
                            t("tempPassword", {
                              name: `${u.firstName} ${u.lastName}`,
                              password: String(res.data.temporaryPassword),
                            }),
                          );
                      }}
                    >
                      {t("resetPassword")}
                    </ConfirmButton>
                    {u.status === "active" ? (
                      <ConfirmButton
                        confirmLabel={t("suspendConfirm")}
                        onConfirm={() => post(`/api/admin/users/${u.id}/suspend`)}
                      >
                        {t("suspend")}
                      </ConfirmButton>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => post(`/api/admin/users/${u.id}/reactivate`)}
                      >
                        {t("reactivate")}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="creer-compte" className="border-line bg-surface rounded-xl border p-4">
          <h2 id="creer-compte" className="mb-3 text-lg font-bold">
            {t("create")}
          </h2>
          <form onSubmit={create} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t("role")}
              <select name="role" className={input} defaultValue="student">
                <option value="student">{t("roleStudent")}</option>
                <option value="admin">{t("roleAdmin")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t("schoolId")}
              <input name="schoolId" required className={input} autoCapitalize="none" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t("firstName")}
              <input name="firstName" required className={input} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t("lastName")}
              <input name="lastName" required className={input} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t("room")}
              <input name="room" className={input} />
            </label>
            <div className="flex items-end">
              <Button type="submit">{t("createSubmit")}</Button>
            </div>
          </form>
        </section>

        <section aria-labelledby="import-csv" className="border-line bg-surface rounded-xl border p-4">
          <h2 id="import-csv" className="mb-1 text-lg font-bold">
            {t("import")}
          </h2>
          <p className="text-muted mb-3 text-sm">{t("importHelp")}</p>
          <form onSubmit={importCsv} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t("importFile")}
              <input name="file" type="file" accept=".csv,text/csv" className="text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t("importText")}
              <textarea
                name="csv"
                rows={4}
                className={`${input} py-2 font-mono text-sm`}
                placeholder={"nom;prénom;chambre;identifiant\nAlaoui;Youssef;A101;E2026-100"}
              />
            </label>
            <Button type="submit" className="self-start">
              {t("importSubmit")}
            </Button>
          </form>
          {importErrors.length > 0 && (
            <div role="alert" className="border-running mt-3 rounded-lg border-2 p-3 text-sm">
              <p className="font-semibold">{t("importErrors")}</p>
              <ul className="mt-1 list-disc ps-5">
                {importErrors.map((e, i) => (
                  <li key={i}>
                    {t("line", { line: e.line })} : {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {credentials.length > 0 && (
            <div className="border-free mt-3 rounded-lg border-2 p-3">
              <p className="font-semibold">{t("importDone", { count: credentials.length })}</p>
              <p className="text-muted text-sm">{t("tempPasswordHint")}</p>
              <Button size="sm" className="mt-2" onClick={downloadCredentials}>
                {t("downloadCredentials")}
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
