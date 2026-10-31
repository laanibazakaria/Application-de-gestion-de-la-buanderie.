"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { api } from "@/lib/api-client";

import { Button } from "../ui/button";

export function LoginForm() {
  const t = useTranslations("login");
  const te = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (!String(form.get("schoolId") ?? "").trim() || !String(form.get("password") ?? "")) {
      setError(t("missing"));
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api<{ user: { mustChangePassword: boolean } }>("/api/auth/login", {
      body: { schoolId: String(form.get("schoolId") ?? ""), password: String(form.get("password") ?? "") },
    });
    if (res.ok) {
      router.replace(res.data.user.mustChangePassword ? "/mot-de-passe" : "/");
      router.refresh();
      return;
    }
    setBusy(false);
    setError(te.has(res.code) ? te(res.code) : te("INTERNAL"));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {error && (
        <p role="alert" className="bg-running rounded-lg px-3 py-2 font-semibold text-white">
          {error}
        </p>
      )}
      <label className="flex flex-col gap-1 font-semibold">
        {t("schoolId")}
        <input
          name="schoolId"
          required
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          className="border-line bg-surface-2 min-h-12 rounded-lg border px-3 text-base font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 font-semibold">
        {t("password")}
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="border-line bg-surface-2 min-h-12 rounded-lg border px-3 text-base font-normal"
        />
      </label>
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? t("submitting") : t("submit")}
      </Button>
      <p className="text-muted text-sm">{t("help")}</p>
    </form>
  );
}
