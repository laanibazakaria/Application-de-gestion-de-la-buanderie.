import { getTranslations } from "next-intl/server";

import { PasswordForm } from "@/components/auth/password-form";
import { requirePageUser } from "@/server/auth/page-auth";

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const user = await requirePageUser({ allowPendingPasswordChange: true });
  const t = await getTranslations("password");
  return (
    <main id="contenu" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <div className="border-line bg-surface rounded-xl border p-5 shadow-sm">
        <h1 className="mb-2 text-xl font-bold">{t("title")}</h1>
        {user.mustChangePassword && <p className="text-muted mb-4">{t("intro")}</p>}
        <PasswordForm />
      </div>
    </main>
  );
}
