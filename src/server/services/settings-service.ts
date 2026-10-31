import { eq } from "drizzle-orm";

import type { AuthUser } from "../auth/session";
import { getDb } from "../db/client";
import { openingHours, settings as settingsTable } from "../db/schema";
import type { Settings } from "../domain/types";

import { bumpVersion, loadSettings, settleDeadlines, withLaundry } from "./laundry-tx";

export interface HoursRow {
  weekday: number;
  isOpen: boolean;
  openMinute: number;
  closeMinute: number;
}

export async function getSettings() {
  const db = getDb();
  const [settings, rows] = await Promise.all([
    loadSettings(db),
    db.select().from(openingHours).orderBy(openingHours.weekday),
  ]);
  return { settings, hours: rows as HoursRow[] };
}

export async function updateSettings(
  admin: AuthUser,
  input: { settings?: Settings | undefined; hours?: HoursRow[] | undefined },
) {
  await withLaundry(async ({ tx, now, log }) => {
    if (input.settings) {
      await tx
        .update(settingsTable)
        .set({ ...input.settings, updatedAt: now })
        .where(eq(settingsTable.id, 1));
      log({
        action: "settings.updated",
        actorId: admin.id,
        entityType: "settings",
        entityId: "1",
        details: { ...input.settings },
      });
    }
    if (input.hours) {
      for (const h of input.hours) {
        await tx
          .update(openingHours)
          .set({ isOpen: h.isOpen, openMinute: h.openMinute, closeMinute: h.closeMinute })
          .where(eq(openingHours.weekday, h.weekday));
      }
      log({
        action: "opening_hours.updated",
        actorId: admin.id,
        entityType: "opening_hours",
        entityId: "week",
        details: { hours: input.hours },
      });
    }
    await bumpVersion(tx, now);
  });
  // Les nouveaux horaires et délais changent la prochaine échéance : on la recalcule.
  await settleDeadlines();
  return getSettings();
}
