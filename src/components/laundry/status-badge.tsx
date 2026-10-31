import { useTranslations } from "next-intl";

import type { MachineStatusView } from "@/lib/state-types";

import { IconFree, IconOffline, IconRunning, IconWaiting } from "../ui/icons";

export const STATUS_STYLES: Record<MachineStatusView, { bg: string; border: string; Icon: typeof IconFree }> =
  {
    free: { bg: "bg-free", border: "border-free", Icon: IconFree },
    awaiting_student: { bg: "bg-waiting", border: "border-waiting", Icon: IconWaiting },
    running: { bg: "bg-running", border: "border-running", Icon: IconRunning },
    out_of_service: { bg: "bg-offline", border: "border-offline", Icon: IconOffline },
  };

/** Statut d'une machine : couleur + icône + texte (jamais la couleur seule). */
export function StatusBadge({ status }: { status: MachineStatusView }) {
  const t = useTranslations("status");
  const { bg, Icon } = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold text-white ${bg}`}
    >
      <Icon width={16} height={16} />
      {t(status)}
    </span>
  );
}
