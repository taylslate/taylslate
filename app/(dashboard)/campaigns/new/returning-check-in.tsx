"use client";

// Returning-brand check-in (Wave 14 2A spec, amended). Brands with a prior
// campaign_patterns row don't get a form prefilled with old answers — they
// get an agent-style check-in. "Nothing has changed" jumps straight to the
// campaign decisions (fast lane). "Yes, here's what's changed" opens the
// prior product URL, customer description, and exclusions pre-filled for
// direct editing; the form tracks which fields changed vs unchanged and
// the brief stores a field-level before/after record alongside the new
// full values.

import { useState } from "react";

export interface PriorBriefValues {
  productUrl: string | null;
  customerText: string | null;
  exclusionsText: string | null;
}

/** Edited full values from the check-in; diffing happens at submit. */
export interface CheckInDelta {
  productUrl: string;
  customerText: string;
  exclusionsText: string;
}

interface Props {
  previousSummary: string | null;
  prior: PriorBriefValues;
  onNothingChanged: () => void;
  onDelta: (delta: CheckInDelta) => void;
  onStartFresh: () => void;
}

const FIELD_CLASS =
  "w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all";

export default function ReturningCheckIn({
  previousSummary,
  prior,
  onNothingChanged,
  onDelta,
  onStartFresh,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [productUrl, setProductUrl] = useState(prior.productUrl ?? "");
  const [customerText, setCustomerText] = useState(prior.customerText ?? "");
  const [exclusionsText, setExclusionsText] = useState(
    prior.exclusionsText ?? ""
  );

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

          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="w-full flex items-center justify-between p-4 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface)] hover:border-[var(--brand-blue)]/30 transition-all text-left"
            >
              <div>
                <div className="font-semibold text-[var(--brand-text)]">
                  Yes, here&rsquo;s what&rsquo;s changed
                </div>
                <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">
                  Review and edit what we have on file.
                </div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <div className="p-4 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface)] space-y-4">
              <div>
                <label
                  htmlFor="check-in-product-url"
                  className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
                >
                  Product URL
                </label>
                <input
                  id="check-in-product-url"
                  type="url"
                  value={productUrl}
                  onChange={(e) => setProductUrl(e.target.value)}
                  placeholder="https://yourbrand.com"
                  className={FIELD_CLASS}
                />
              </div>
              <div>
                <label
                  htmlFor="check-in-customer"
                  className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
                >
                  Customer description
                </label>
                <textarea
                  id="check-in-customer"
                  value={customerText}
                  onChange={(e) => setCustomerText(e.target.value)}
                  rows={3}
                  placeholder="Who buys this? What do they care about?"
                  className={`${FIELD_CLASS} resize-none`}
                />
              </div>
              <div>
                <label
                  htmlFor="check-in-exclusions"
                  className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
                >
                  Exclusions
                </label>
                <textarea
                  id="check-in-exclusions"
                  value={exclusionsText}
                  onChange={(e) => setExclusionsText(e.target.value)}
                  rows={2}
                  placeholder="Competitors we shouldn't appear next to, topics to avoid."
                  className={`${FIELD_CLASS} resize-none`}
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  onDelta({
                    productUrl: productUrl.trim(),
                    customerText: customerText.trim(),
                    exclusionsText: exclusionsText.trim(),
                  })
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-semibold transition-colors"
              >
                Continue with this update
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
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
