"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { formatTime } from "@/lib/format";
import type { QueueEntryView } from "@/lib/state-types";

import { useLaundry } from "../laundry/laundry-provider";
import { studentName } from "../laundry/machine-card";
import { Button } from "../ui/button";
import { ConfirmButton } from "../ui/confirm-button";

/**
 * File d'une machine, réordonnable par glisser-déposer (souris, tactile, clavier)
 * et par boutons Monter / Descendre. Un déplacement place la réservation juste
 * avant celle qui la suit désormais (ou en fin de file).
 */
export function SortableQueue({ machineId, queue }: { machineId: number; queue: QueueEntryView[] }) {
  const t = useTranslations("admin.pilot");
  const { act, state } = useLaundry();
  const [order, setOrder] = useState(queue);
  // L'état du serveur fait foi : on resynchronise à chaque nouvelle version.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reflet de l'état serveur
  useEffect(() => setOrder(queue), [queue, state.version]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    const moved = next[to]!;
    const before = next[to + 1]?.reservationId ?? null;
    await act(`/api/admin/queue/${moved.reservationId}/move`, { beforeId: before });
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = order.findIndex((q) => q.reservationId === e.active.id);
    const to = order.findIndex((q) => q.reservationId === e.over!.id);
    void move(from, to);
  }

  if (order.length === 0) return <p className="text-muted text-sm">{t("queueEmpty")}</p>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      id={`dnd-${machineId}`}
    >
      <SortableContext items={order.map((q) => q.reservationId)} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-1" aria-describedby={`aide-dnd-${machineId}`}>
          {order.map((q, i) => (
            <Row key={q.reservationId} entry={q} index={i} count={order.length} onMove={move} />
          ))}
        </ol>
      </SortableContext>
      <p id={`aide-dnd-${machineId}`} className="sr-only">
        {t("dragHelp")}
      </p>
    </DndContext>
  );
}

function Row({
  entry,
  index,
  count,
  onMove,
}: {
  entry: QueueEntryView;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
}) {
  const t = useTranslations("admin.pilot");
  const { act } = useLaundry();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.reservationId,
  });
  const name = studentName(entry.student) ?? "?";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-line bg-surface-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2 py-1.5 text-sm ${isDragging ? "z-10 shadow-lg" : ""}`}
      data-testid="admin-queue-entry"
    >
      <button
        type="button"
        className="text-muted cursor-grab touch-none rounded px-1 text-lg leading-none"
        aria-label={t("dragHandle", { name })}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span className="font-semibold tabular-nums">{entry.position}.</span>
      <span className="font-semibold">{name}</span>
      {entry.isAny && <span className="border-line rounded border px-1 text-xs">{t("anyTag")}</span>}
      {entry.student?.noShowWarning && (
        <span className="bg-waiting rounded px-1 text-xs font-semibold text-white">
          ⚠ {t("noShowWarning", { count: entry.student.noShowCount ?? 0 })}
        </span>
      )}
      <span className="text-muted ms-auto">{entry.estimatedAt ? formatTime(entry.estimatedAt) : "—"}</span>
      <span className="flex w-full justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={index === 0}
          aria-label={t("moveUpLabel", { name })}
          onClick={() => onMove(index, index - 1)}
        >
          ↑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={index === count - 1}
          aria-label={t("moveDownLabel", { name })}
          onClick={() => onMove(index, index + 1)}
        >
          ↓
        </Button>
        <ConfirmButton
          ariaLabel={t("removeLabel", { name })}
          confirmLabel={t("removeConfirm")}
          onConfirm={() => act(`/api/reservations/${entry.reservationId}/cancel`)}
        >
          {t("remove")}
        </ConfirmButton>
      </span>
    </li>
  );
}
