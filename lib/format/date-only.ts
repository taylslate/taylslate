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
