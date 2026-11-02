// The air window is the IO line post_date plus the next 6 days.
// The cron keeps looking for 7 days after the window closes so a late
// publish is still pulled. Dates are UTC calendar days.

export const AIRCHECK_WINDOW_DAYS = 7;
export const AIRCHECK_CATCHUP_DAYS = 7;
export const AIRCHECK_SPOTS_PER_RUN = 25;

const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDay(value: string | Date): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

export function addUtcDays(day: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(earlier: string, later: string): number | null {
  const a = Date.parse(`${earlier}T00:00:00.000Z`);
  const b = Date.parse(`${later}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

export interface AirWindow {
  start: string;
  end: string;
}

/** Inclusive window that starts on the line's post date. */
export function airWindow(postDate: string): AirWindow | null {
  const start = utcDay(postDate);
  if (!start) return null;
  const end = addUtcDays(start, AIRCHECK_WINDOW_DAYS - 1);
  if (!end) return null;
  return { start, end };
}

/**
 * True when today is on or after the post date and still inside the
 * catch-up that follows the window.
 */
export function spotIsDue(postDate: string, today: string): boolean {
  const window = airWindow(postDate);
  const day = utcDay(today);
  if (!window || !day) return false;
  if (day < window.start) return false;
  const last = addUtcDays(window.end, AIRCHECK_CATCHUP_DAYS);
  if (!last) return false;
  return day <= last;
}

/** True when a calendar day falls inside the inclusive window. */
export function dayInWindow(day: string | null, window: AirWindow): boolean {
  if (!day) return false;
  return day >= window.start && day <= window.end;
}
