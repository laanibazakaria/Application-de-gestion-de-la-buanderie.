/**
 * Utilitaires de fuseau horaire sans dépendance externe (Intl + base IANA de Node).
 *
 * Toutes les dates sont manipulées en instants UTC (`Date`). On ne convertit vers
 * l'heure locale (Africa/Casablanca) que pour comparer aux horaires d'ouverture et
 * pour l'affichage. On n'utilise jamais un décalage fixe : le Maroc change d'heure
 * (notamment pendant le Ramadan), et la base IANA connaît ces changements.
 */

export const MINUTE_MS = 60_000;

export interface ZonedParts {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  /** Jour ISO : 1 = lundi … 7 = dimanche. */
  weekday: number;
  /** Minutes écoulées depuis minuit, heure locale. */
  minuteOfDay: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function rawParts(date: Date, timeZone: string) {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? ""] ?? 0,
  };
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const p = rawParts(date, timeZone);
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    weekday: p.weekday,
    minuteOfDay: p.hour * 60 + p.minute,
  };
}

/** Décalage (ms) entre l'heure locale et UTC à l'instant donné. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = rawParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convertit une heure locale (date + minutes depuis minuit) en instant UTC. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  // Deux passes : la seconde corrige le cas où l'heure visée est de l'autre côté d'un changement d'heure.
  let result = naive - timeZoneOffsetMs(new Date(naive), timeZone);
  result = naive - timeZoneOffsetMs(new Date(result), timeZone);
  return new Date(result);
}

/** Ajoute `days` jours à une date civile (sans fuseau). */
export function addCivilDays(year: number, month: number, day: number, days: number) {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}
