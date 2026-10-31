"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { formatTime } from "@/lib/format";

import { Button } from "../ui/button";

import { useLaundry } from "./laundry-provider";
import { useCanReserve } from "./machine-card";

export function SummaryBar() {
  const t = useTranslations("summary");
  const { state, act } = useLaundry();
  const canReserve = useCanReserve();
  const [busy, setBusy] = useState(false);
  const { summary, laundry } = state;

  return (
    <section
      aria-labelledby="resume-titre"
      className="border-line bg-surface rounded-xl border p-4 shadow-sm"
    >
      <h2 id="resume-titre" className="sr-only">
        {t("title")}
      </h2>
      {!laundry.open && (
        <p role="status" className="bg-offline mb-3 rounded-lg px-3 py-2 font-semibold text-white">
          {laundry.nextOpeningAt
            ? t("closed", { time: formatTime(laundry.nextOpeningAt) })
            : t("closedNoOpening")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <p className="text-2xl font-bold" data-testid="free-count">
          {t("free", { count: summary.freeCount })}
        </p>
        <p>
          <span className="text-muted">{t("shortestWait")} : </span>
          <strong data-testid="shortest-wait">
            {summary.shortestWaitMin === null
              ? t("unavailable")
              : summary.shortestWaitMin === 0
                ? t("now")
                : `${t("minutes", { count: summary.shortestWaitMin })} (${formatTime(summary.shortestWaitAt)})`}
          </strong>
        </p>
        {laundry.open && laundry.closesAt && (
          <p className="text-muted text-sm">{t("closesAt", { time: formatTime(laundry.closesAt) })}</p>
        )}
        {state.viewer.role === "student" && (
          <Button
            size="lg"
            className="w-full sm:ms-auto sm:w-auto"
            disabled={!canReserve || busy}
            onClick={async () => {
              setBusy(true);
              await act("/api/reservations", { targetMachineId: null });
              setBusy(false);
            }}
          >
            {t("reserveAny")}
          </Button>
        )}
      </div>
    </section>
  );
}
