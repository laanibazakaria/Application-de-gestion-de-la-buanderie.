import { describe, expect, it } from "vitest";

import { zonedParts, zonedTimeToUtc } from "@/lib/time";
import {
  currentPeriod,
  isOpenAt,
  isValidDayHours,
  lastClosingAtOrBefore,
  nextOpeningAfter,
  type WeeklyHours,
} from "@/server/domain/opening-hours";

const TZ = "Africa/Casablanca";
const h = (hh: number, mm = 0) => hh * 60 + mm;

/** Lun–ven 08:00–22:00, samedi 10:00–18:00, dimanche fermé. */
const HOURS: WeeklyHours = {
  1: { openMinute: h(8), closeMinute: h(22) },
  2: { openMinute: h(8), closeMinute: h(22) },
  3: { openMinute: h(8), closeMinute: h(22) },
  4: { openMinute: h(8), closeMinute: h(22) },
  5: { openMinute: h(8), closeMinute: h(22) },
  6: { openMinute: h(10), closeMinute: h(18) },
  7: null,
};

describe("fuseau Africa/Casablanca", () => {
  it("janvier 2026 : UTC+1", () => {
    const p = zonedParts(new Date("2026-01-14T10:00:00Z"), TZ);
    expect(p).toMatchObject({ year: 2026, month: 1, day: 14, weekday: 3, minuteOfDay: h(11) });
    expect(zonedTimeToUtc(2026, 1, 14, h(8), TZ).toISOString()).toBe("2026-01-14T07:00:00.000Z");
  });

  it("pendant le Ramadan 2026 (mars) : UTC+0", () => {
    expect(zonedParts(new Date("2026-03-04T10:00:00Z"), TZ).minuteOfDay).toBe(h(10));
    expect(zonedTimeToUtc(2026, 3, 4, h(8), TZ).toISOString()).toBe("2026-03-04T08:00:00.000Z");
  });

  it("conversion aller-retour cohérente toute l'année", () => {
    for (let month = 1; month <= 12; month++) {
      const utc = zonedTimeToUtc(2026, month, 10, h(9, 30), TZ);
      expect(zonedParts(utc, TZ)).toMatchObject({ month, day: 10, minuteOfDay: h(9, 30) });
    }
  });
});

describe("horaires d'ouverture", () => {
  it("ouvert pendant la plage, fermé avant et à l'heure de fermeture", () => {
    // Mercredi 14/01/2026, heure locale = UTC+1
    expect(isOpenAt(HOURS, new Date("2026-01-14T06:59:00Z"), TZ)).toBe(false); // 07:59
    expect(isOpenAt(HOURS, new Date("2026-01-14T07:00:00Z"), TZ)).toBe(true); // 08:00
    expect(isOpenAt(HOURS, new Date("2026-01-14T20:59:00Z"), TZ)).toBe(true); // 21:59
    expect(isOpenAt(HOURS, new Date("2026-01-14T21:00:00Z"), TZ)).toBe(false); // 22:00
  });

  it("horaires différents selon le jour", () => {
    // Samedi 17/01 à 09:00 locale : fermé (ouvre à 10:00), à 17:00 : ouvert
    expect(isOpenAt(HOURS, new Date("2026-01-17T08:00:00Z"), TZ)).toBe(false);
    expect(isOpenAt(HOURS, new Date("2026-01-17T16:00:00Z"), TZ)).toBe(true);
    // Dimanche 18/01 : fermé toute la journée
    expect(isOpenAt(HOURS, new Date("2026-01-18T12:00:00Z"), TZ)).toBe(false);
  });

  it("donne la plage en cours", () => {
    const p = currentPeriod(HOURS, new Date("2026-01-14T10:00:00Z"), TZ);
    expect(p?.opensAt.toISOString()).toBe("2026-01-14T07:00:00.000Z");
    expect(p?.closesAt.toISOString()).toBe("2026-01-14T21:00:00.000Z");
  });

  it("dernière fermeture et prochaine ouverture", () => {
    // Dimanche 18/01 midi : dernière fermeture = samedi 18:00 locale, prochaine ouverture = lundi 08:00
    const sunday = new Date("2026-01-18T12:00:00Z");
    expect(lastClosingAtOrBefore(HOURS, sunday, TZ)?.toISOString()).toBe("2026-01-17T17:00:00.000Z");
    expect(nextOpeningAfter(HOURS, sunday, TZ)?.toISOString()).toBe("2026-01-19T07:00:00.000Z");
  });

  it("valide les plages", () => {
    expect(isValidDayHours({ openMinute: h(8), closeMinute: h(22) })).toBe(true);
    expect(isValidDayHours({ openMinute: h(22), closeMinute: h(8) })).toBe(false);
    expect(isValidDayHours({ openMinute: 0, closeMinute: 24 * 60 + 1 })).toBe(false);
  });
});
