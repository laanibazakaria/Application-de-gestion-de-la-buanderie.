import { getTranslations } from "next-intl/server";

import { StatsView } from "@/components/admin/stats-view";
import { requirePageUser } from "@/server/auth/page-auth";
import { getSettings } from "@/server/services/settings-service";
import { getStats } from "@/server/services/stats-service";

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePageUser({ role: "admin" });
  const t = await getTranslations("admin.stats");
  const raw = Number((await searchParams).jours);
  const days = [7, 30, 90].includes(raw) ? raw : 30;
  const [stats, { settings }] = await Promise.all([getStats(days), getSettings()]);
  return (
    <>
      <h1 className="mb-3 text-2xl font-bold">{t("title")}</h1>
      <StatsView
        stats={stats}
        threshold={settings.noShowWarningThreshold}
        windowDays={settings.noShowWindowDays}
      />
    </>
  );
}
