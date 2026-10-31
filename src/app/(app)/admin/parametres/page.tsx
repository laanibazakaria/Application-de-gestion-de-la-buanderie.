import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { SettingsForm } from "@/components/admin/settings-form";
import { requirePageUser } from "@/server/auth/page-auth";
import { getDb } from "@/server/db/client";
import { machines } from "@/server/db/schema";
import { getSettings } from "@/server/services/settings-service";

export default async function SettingsPage() {
  await requirePageUser({ role: "admin" });
  const t = await getTranslations("admin.settings");
  const { settings, hours } = await getSettings();
  const machineRows = await getDb()
    .select({
      id: machines.id,
      number: machines.number,
      name: machines.name,
      defaultDurationMin: machines.defaultDurationMin,
    })
    .from(machines)
    .orderBy(asc(machines.number));
  return (
    <>
      <h1 className="mb-3 text-2xl font-bold">{t("title")}</h1>
      <SettingsForm initial={settings} initialHours={hours} machines={machineRows} />
    </>
  );
}
