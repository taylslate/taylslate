import type { MarketSignal } from "@/lib/discovery/market-signals";

/**
 * Context on a discovery card. The list is the whole job: a signal never
 * hides, sorts, or blocks the show.
 */
export default function MarketSignals({ signals }: { signals: MarketSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <div
      data-testid="market-signals"
      className="mt-3 border-t border-[var(--ts-hairline-on-paper)] pt-3"
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
        Market signals
      </div>
      <dl className="mt-2 space-y-2">
        {signals.map((signal) => (
          <div key={signal.id} data-testid={`market-signal-${signal.id}`}>
            <dt className="text-[11px] font-medium text-[var(--ts-ink-on-paper)]">
              {signal.label}
            </dt>
            <dd className="text-xs leading-snug text-[var(--ts-ink-on-paper)]">
              <span data-testid={`market-signal-${signal.id}-value`}>{signal.value}</span>
              <p className="text-[var(--ts-ink-muted-on-paper)]">{signal.why}</p>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
