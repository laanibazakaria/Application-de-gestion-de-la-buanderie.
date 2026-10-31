import { addCivilDays, zonedParts, zonedTimeToUtc } from "@/lib/time";

/** Une plage d'ouverture pour un jour, en minutes depuis minuit (heure locale). */
export interface DayHours {
  openMinute: number;
  closeMinute: number;
}

/** Horaires de la semaine. Clé : jour ISO (1 = lundi … 7 = dimanche). `null` = fermé ce jour-là. */
export type WeeklyHours = Readonly<Record<number, DayHours | null>>;

export interface Period {
  opensAt: Date;
  closesAt: Date;
}

/** Plages d'ouverture (en instants UTC) des jours compris entre `fromOffset` et `toOffset` autour de `date`. */
function periodsAround(
  hours: WeeklyHours,
  date: Date,
  timeZone: string,
  fromOffset: number,
  toOffset: number,
) {
  const today = zonedParts(date, timeZone);
  const periods: Period[] = [];
  for (let offset = fromOffset; offset <= toOffset; offset++) {
    const civil = addCivilDays(today.year, today.month, today.day, offset);
    const weekday = ((((today.weekday - 1 + offset) % 7) + 7) % 7) + 1;
    const h = hours[weekday];
    if (!h || h.closeMinute <= h.openMinute) continue;
    periods.push({
      opensAt: zonedTimeToUtc(civil.year, civil.month, civil.day, h.openMinute, timeZone),
      closesAt: zonedTimeToUtc(civil.year, civil.month, civil.day, h.closeMinute, timeZone),
    });
  }
  return periods;
}

/** Plage d'ouverture en cours à l'instant `date`, ou `null` si la buanderie est fermée. */
export function currentPeriod(hours: WeeklyHours, date: Date, timeZone: string): Period | null {
  const t = date.getTime();
  return (
    periodsAround(hours, date, timeZone, 0, 0).find(
      (p) => p.opensAt.getTime() <= t && t < p.closesAt.getTime(),
    ) ?? null
  );
}

export function isOpenAt(hours: WeeklyHours, date: Date, timeZone: string): boolean {
  return currentPeriod(hours, date, timeZone) !== null;
}

/** Dernière fermeture survenue au plus tard à `date` (sur les 8 derniers jours), ou `null`. */
export function lastClosingAtOrBefore(hours: WeeklyHours, date: Date, timeZone: string): Date | null {
  const t = date.getTime();
  const past = periodsAround(hours, date, timeZone, -8, 0).filter((p) => p.closesAt.getTime() <= t);
  return past.at(-1)?.closesAt ?? null;
}

/** Prochaine ouverture strictement après `date` (sur les 8 prochains jours), ou `null`. */
export function nextOpeningAfter(hours: WeeklyHours, date: Date, timeZone: string): Date | null {
  const t = date.getTime();
  return periodsAround(hours, date, timeZone, 0, 8).find((p) => p.opensAt.getTime() > t)?.opensAt ?? null;
}

/** Vérifie qu'une plage est cohérente (ouverture avant fermeture, dans la même journée). */
export function isValidDayHours(h: DayHours): boolean {
  return (
    Number.isInteger(h.openMinute) &&
    Number.isInteger(h.closeMinute) &&
    h.openMinute >= 0 &&
    h.closeMinute <= 24 * 60 &&
    h.openMinute < h.closeMinute
  );
}
