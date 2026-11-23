/** Small verified mark for a brand looking at a show. */
export default function VerifiedBadge() {
  return (
    <span
      data-testid="verified-badge"
      aria-label="Verified show"
      className="shrink-0 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--ts-ink-muted-on-paper)]"
    >
      Verified
    </span>
  );
}
