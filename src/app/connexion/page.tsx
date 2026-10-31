import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LoginForm } from "@/components/auth/login-form";
import { getPageUser } from "@/server/auth/page-auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getPageUser();
  if (user) redirect(user.mustChangePassword ? "/mot-de-passe" : "/");
  const t = await getTranslations();
  return (
    <main id="contenu" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <p className="mb-2 text-center text-4xl" aria-hidden>
        🧺
      </p>
      <h1 className="mb-1 text-center text-2xl font-extrabold">{t("app.name")}</h1>
      <p className="text-muted mb-6 text-center">{t("app.tagline")}</p>
      <div className="border-line bg-surface rounded-xl border p-5 shadow-sm">
        <h2 className="mb-4 text-xl font-bold">{t("login.title")}</h2>
        <LoginForm />
      </div>
    </main>
  );
}
