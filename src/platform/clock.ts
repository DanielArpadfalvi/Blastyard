/**
 * Wall clock behind the platform layer (CLAUDE.md: the real time never reaches `src/core`).
 * The game uses it only for things that must differ between sessions, such as match seeds.
 */

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** A calendar date (local time zone). */
export interface CalendarDate {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  /** 1–31. */
  readonly day: number;
}

/** Today's date in the device's time zone (the daily challenge changes at local midnight). */
export function localDate(clock: Clock = systemClock): CalendarDate {
  const d = new Date(clock.now());
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Parses `YYYY-MM-DD` (tests and the `?date` override); null when malformed. */
export function parseDate(text: string | null): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day
    ? { year, month, day }
    : null;
}
