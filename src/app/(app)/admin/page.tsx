import { getTranslations } from "next-intl/server";

import { AdminPilot } from "@/components/admin/admin-pilot";

export default async function AdminPilotPage() {
  const t = await getTranslations("admin.pilot");
  return (
    <>
      <h1 className="mb-3 text-2xl font-bold">{t("title")}</h1>
      <AdminPilot />
    </>
  );
}
