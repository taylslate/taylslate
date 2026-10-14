// Single source of truth for rendering DATE-ONLY values (stored as "YYYY-MM-DD").
// Such a value parses as UTC midnight, so any formatter that omits
// `timeZone: "UTC"` shifts it a day earlier for US (negative-offset) viewers.
// Every surface that shows flight dates or line-item post dates — the public
// pitch page, the Wave 12 deal view, the legacy deal view, the IO preview, and
// the outreach email — MUST format through this so they all agree.
//
// Do NOT use this for real timestamps (created_at, signed_at, …): forcing UTC on
// a moment-in-time can misreport the viewer's local calendar day. This is for
// values that are inherently a calendar date with no time component.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar day stored as YYYY-MM-DD. Rejects rollovers like 2026-02-31. */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_ONLY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * UTC calendar day for `now`, as YYYY-MM-DD.
 * Date-only values in this app are UTC days (see formatDateOnly). Using the
 * UTC day here keeps "today + N" on the same calendar the rest of the app renders.
 */
export function todayDateOnly(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Add whole UTC days to a YYYY-MM-DD value. Local setDate/toISOString can shift a day. */
export function addDaysDateOnly(value: string, days: number): string {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`addDaysDateOnly: invalid date ${value}`);
  }
  d.setUTCDate(d.getUTCDate() + Math.trunc(days));
  return d.toISOString().slice(0, 10);
}

export function formatDateOnly(value?: string | null): string {
  const v = value?.trim();
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
