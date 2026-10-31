import { getTranslations } from "next-intl/server";

import { formatDateTime } from "@/lib/format";
import { requirePageUser } from "@/server/auth/page-auth";
import { myHistory } from "@/server/services/history-service";

export default async function HistoryPage() {
  const user = await requirePageUser({ role: "student" });
  const t = await getTranslations("history");
  const { cycles, reservations } = await myHistory(user);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      <section aria-labelledby="h-cycles" className="border-line bg-surface rounded-xl border p-4">
        <h2 id="h-cycles" className="mb-2 text-lg font-bold">
          {t("cycles")}
        </h2>
        {cycles.length === 0 ? (
          <p className="text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-line divide-y">
            {cycles.map((c) => (
              <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <strong>Machine {c.machineNumber}</strong> · {formatDateTime(c.startedAt)}
                </span>
                <span className="text-muted">
                  {t("minutes", { count: c.plannedDurationMin })} ·{" "}
                  {t(`cycleStatus.${c.status === "running" ? "running" : (c.endReason ?? "completed")}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="h-resa" className="border-line bg-surface rounded-xl border p-4">
        <h2 id="h-resa" className="mb-2 text-lg font-bold">
          {t("reservations")}
        </h2>
        {reservations.length === 0 ? (
          <p className="text-muted">{t("empty")}</p>
        ) : (
          <ul className="divide-line divide-y">
            {reservations.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <strong>{r.targetMachineNumber ? `Machine ${r.targetMachineNumber}` : t("any")}</strong>
                  {r.assignedMachineNumber && !r.targetMachineNumber
                    ? ` → ${r.assignedMachineNumber}`
                    : ""} · {formatDateTime(r.createdAt)}
                </span>
                <span className="text-muted">{t(`reservationStatus.${r.closeReason ?? r.status}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
