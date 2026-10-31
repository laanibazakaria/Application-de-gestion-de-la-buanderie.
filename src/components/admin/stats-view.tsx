"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import type { Stats } from "@/server/services/stats-service";

import { ColumnChart, HBarChart } from "./charts";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-line bg-surface rounded-xl border p-4">
      <p className="text-muted text-sm">{label}</p>
      <p className="text-3xl font-extrabold tabular-nums">{value}</p>
      {sub && <p className="text-muted text-sm">{sub}</p>}
    </div>
  );
}

export function StatsView({
  stats,
  threshold,
  windowDays,
}: {
  stats: Stats;
  threshold: number;
  windowDays: number;
}) {
  const t = useTranslations("admin.stats");
  const weekdays = useTranslations("admin.settings").raw("weekdays") as string[];
  const nf = new Intl.NumberFormat("fr-FR");
  const pct = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 });
  const totalCalls = stats.noShow.fulfilled + stats.noShow.noShows + stats.noShow.notStarted;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t("period")} className="flex flex-wrap gap-1">
        {[7, 30, 90].map((d) => (
          <Link
            key={d}
            href={`?jours=${d}`}
            aria-current={stats.days === d ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-lg border px-3 text-sm font-semibold ${stats.days === d ? "border-fg bg-fg text-bg" : "border-line bg-surface"}`}
          >
            {t("days", { count: d })}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label={t("cycles")} value={nf.format(stats.totals.cycles)} />
        <Tile label={t("hours")} value={nf.format(stats.totals.hours)} />
        <Tile label={t("students")} value={nf.format(stats.totals.students)} />
        <Tile
          label={t("avgWait")}
          value={
            stats.totals.avgWaitMin === null ? t("none") : t("minutes", { count: stats.totals.avgWaitMin })
          }
        />
        <Tile
          label={t("noShowRate")}
          value={stats.noShow.rate === null ? t("none") : pct.format(stats.noShow.rate)}
          sub={t("noShowDetail", { noShows: stats.noShow.noShows, total: totalCalls })}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="st-machines" className="border-line bg-surface rounded-xl border p-4">
          <h2 id="st-machines" className="text-lg font-bold">
            {t("perMachine")}
          </h2>
          <p className="text-muted mb-3 text-sm">{t("perMachineSub")}</p>
          <HBarChart
            rows={stats.perMachine.map((m) => ({
              label: m.name,
              value: m.cycles,
              tooltip: t("tooltipMachine", { name: m.name, cycles: m.cycles, hours: nf.format(m.hours) }),
            }))}
          />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold">{t("showTable")}</summary>
            <table className="mt-2 w-full">
              <thead>
                <tr>
                  <th scope="col" className="text-start">
                    {t("machine")}
                  </th>
                  <th scope="col" className="text-end">
                    {t("count")}
                  </th>
                  <th scope="col" className="text-end">
                    {t("hours")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.perMachine.map((m) => (
                  <tr key={m.machineNumber} className="border-line border-t">
                    <th scope="row" className="py-1 text-start font-normal">
                      {m.name}
                    </th>
                    <td className="text-end tabular-nums">{m.cycles}</td>
                    <td className="text-end tabular-nums">{nf.format(m.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>

        <section aria-labelledby="st-heures" className="border-line bg-surface rounded-xl border p-4">
          <h2 id="st-heures" className="text-lg font-bold">
            {t("perHour")}
          </h2>
          <p className="text-muted mb-6 text-sm">{t("perHourSub")}</p>
          <ColumnChart
            ariaLabel={t("perHour")}
            values={stats.perHour}
            xLabel={(i) => `${i}h`}
            tooltip={(i, v) => t("tooltipHour", { hour: i, count: v })}
          />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold">{t("showTable")}</summary>
            <table className="mt-2 w-full">
              <thead>
                <tr>
                  <th scope="col" className="text-start">
                    {t("hour")}
                  </th>
                  <th scope="col" className="text-end">
                    {t("count")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.perHour.map((v, h) => (
                  <tr key={h} className="border-line border-t">
                    <th scope="row" className="py-0.5 text-start font-normal">
                      {h}h–{h + 1}h
                    </th>
                    <td className="text-end tabular-nums">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <h3 className="mt-4 mb-2 font-semibold">{t("perWeekday")}</h3>
          <HBarChart
            rows={stats.perWeekday.map((v, i) => ({
              label: weekdays[i] ?? String(i + 1),
              value: v,
              tooltip: `${weekdays[i]} : ${v}`,
            }))}
          />
        </section>
      </div>

      <section aria-labelledby="st-absences" className="border-line bg-surface rounded-xl border p-4">
        <h2 id="st-absences" className="text-lg font-bold">
          {t("warnings")}
        </h2>
        <p className="text-muted mb-3 text-sm">{t("warningsSub", { threshold, days: windowDays })}</p>
        {stats.warnings.length === 0 ? (
          <p className="text-muted">{t("noWarnings")}</p>
        ) : (
          <ul className="divide-line divide-y">
            {stats.warnings.map((w) => (
              <li key={w.id} className="flex justify-between py-2">
                <span>
                  <strong>
                    {w.lastName} {w.firstName}
                  </strong>
                  {w.room && <span className="text-muted"> · {w.room}</span>}
                </span>
                <span className="bg-waiting rounded px-2 font-semibold text-white">⚠ {w.noShows}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
