import { getTranslations } from "next-intl/server";

import { Accounts } from "@/components/admin/accounts";
import { requirePageUser } from "@/server/auth/page-auth";
import { getSettings } from "@/server/services/settings-service";

export default async function AccountsPage() {
  const user = await requirePageUser({ role: "admin" });
  const t = await getTranslations("admin.accounts");
  const { settings } = await getSettings();
  return (
    <>
      <h1 className="mb-3 text-2xl font-bold">{t("title")}</h1>
      <Accounts noShowWindowDays={settings.noShowWindowDays} selfId={user.id} />
    </>
  );
}
