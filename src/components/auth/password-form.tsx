"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { api } from "@/lib/api-client";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation";

import { Button } from "../ui/button";

export function PasswordForm() {
  const t = useTranslations("password");
  const te = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = String(form.get("new") ?? "");
    if (next.length < PASSWORD_MIN_LENGTH) return setError(t("rules", { min: PASSWORD_MIN_LENGTH }));
    if (next !== String(form.get("confirm") ?? "")) return setError(t("mismatch"));
    setBusy(true);
    setError(null);
    const res = await api("/api/auth/password", {
      body: { currentPassword: String(form.get("current") ?? ""), newPassword: next },
    });
    if (res.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    setBusy(false);
    setError(te.has(res.code) ? te(res.code) : te("INTERNAL"));
  }

  const input = "min-h-12 rounded-lg border border-line bg-surface-2 px-3 text-base font-normal";
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {error && (
        <p role="alert" className="bg-running rounded-lg px-3 py-2 font-semibold text-white">
          {error}
        </p>
      )}
      <label className="flex flex-col gap-1 font-semibold">
        {t("current")}
        <input name="current" type="password" required autoComplete="current-password" className={input} />
      </label>
      <label className="flex flex-col gap-1 font-semibold">
        {t("new")}
        <input
          name="new"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          aria-describedby="regles-mdp"
          className={input}
        />
        <span id="regles-mdp" className="text-muted text-sm font-normal">
          {t("rules", { min: PASSWORD_MIN_LENGTH })}
        </span>
      </label>
      <label className="flex flex-col gap-1 font-semibold">
        {t("confirm")}
        <input name="confirm" type="password" required autoComplete="new-password" className={input} />
      </label>
      <Button type="submit" size="lg" disabled={busy}>
        {t("submit")}
      </Button>
    </form>
  );
}
