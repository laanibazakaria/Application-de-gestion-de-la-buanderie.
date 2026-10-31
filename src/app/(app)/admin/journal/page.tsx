import { getTranslations } from "next-intl/server";

import { ActivityLog } from "@/components/admin/activity-log";

export default async function ActivityPage() {
  const t = await getTranslations("admin.activity");
  return (
    <>
      <h1 className="mb-3 text-2xl font-bold">{t("title")}</h1>
      <ActivityLog />
    </>
  );
}
