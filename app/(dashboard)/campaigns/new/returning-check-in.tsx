"use client";

// Returning-brand check-in (Wave 14 2A spec). Brands with a prior
// campaign_patterns row don't get a form prefilled with old answers —
// they get an agent-style check-in. "Nothing has changed" jumps straight
// to the campaign decisions; a free-text delta gets appended to the brief
// as additional context for the interpretation prompt.

import { useState } from "react";

interface Props {
  previousSummary: string | null;
  onNothingChanged: () => void;
  onDelta: (delta: string) => void;
  onStartFresh: () => void;
}

export default function ReturningCheckIn({
  previousSummary,
  onNothingChanged,
  onDelta,
  onStartFresh,
}: Props) {
  const [delta, setDelta] = useState("");

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
          New Campaign
        </h1>
      </div>

      <div className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-6">
        <p className="text-sm text-[var(--brand-text)] leading-relaxed">
          Welcome back.{" "}
          {previousSummary ? (
            <>
              Last time I read your customer as{" "}
              <strong className="font-semibold">{previousSummary}</strong>.
            </>
          ) : (
            <>I&rsquo;ve got your last campaign on file.</>
          )}{" "}
          Anything changed about the customer, product, or what&rsquo;s working
          since then?
        </p>

        <div className="mt-6 space-y-4">
          <button
            type="button"
            onClick={onNothingChanged}
            className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.04] hover:bg-[var(--brand-blue)]/[0.08] transition-all text-left"
          >
            <div>
              <div className="font-semibold text-[var(--brand-text)]">
                Nothing has changed
              </div>
              <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">
                Jump straight to goals, budget, and timing.
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>

          <div>
            <label
              htmlFor="check-in-delta"
              className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
            >
              Yes, here&rsquo;s what&rsquo;s changed
            </label>
            <textarea
              id="check-in-delta"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              rows={3}
              placeholder="New product line, different customer, a channel that started working..."
              className="w-full px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
            />
            {delta.trim().length > 0 && (
              <button
                type="button"
                onClick={() => onDelta(delta.trim())}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-semibold transition-colors"
              >
                Continue with this update
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onStartFresh}
        className="mt-4 text-sm font-medium text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
      >
        Actually, treat this as a new brief →
      </button>
    </div>
  );
}
