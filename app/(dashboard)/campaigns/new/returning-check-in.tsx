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
import { tokens } from "@/lib/brand/tokens";

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
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";

const radiusStyle = { borderRadius: tokens.radius };

const labelClass = "mb-1.5 block text-sm font-medium";

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
    <div className="max-w-2xl p-4 sm:p-8">
      <div className="mb-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]">
          For brands
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          New Campaign
        </h1>
      </div>

      <div
        className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-6"
        style={radiusStyle}
      >
        <p className="text-sm leading-relaxed">
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
            className="flex w-full items-center justify-between border border-[var(--ts-ink-on-paper)] bg-[var(--ts-ink-on-paper)] p-4 text-left text-[var(--ts-paper)] hover:opacity-90"
            style={radiusStyle}
          >
            <div>
              <div className="font-medium">Nothing has changed</div>
              <div className="mt-0.5 text-xs text-[var(--ts-paper)]/80">
                Jump straight to goals, budget, and timing.
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>

          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex w-full items-center justify-between border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4 text-left hover:bg-[var(--ts-band-shows)]"
              style={radiusStyle}
            >
              <div>
                <div className="font-medium">
                  Yes, here&rsquo;s what&rsquo;s changed
                </div>
                <div className="mt-0.5 text-xs text-[var(--ts-ink-muted-on-paper)]">
                  Review and edit what we have on file.
                </div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          ) : (
            <div
              className="space-y-4 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4"
              style={radiusStyle}
            >
              <div>
                <label htmlFor="check-in-product-url" className={labelClass}>
                  Product URL
                </label>
                <input
                  id="check-in-product-url"
                  type="url"
                  value={productUrl}
                  onChange={(e) => setProductUrl(e.target.value)}
                  placeholder="https://yourbrand.com"
                  className={FIELD_CLASS}
                  style={radiusStyle}
                />
              </div>
              <div>
                <label htmlFor="check-in-customer" className={labelClass}>
                  Customer description
                </label>
                <textarea
                  id="check-in-customer"
                  value={customerText}
                  onChange={(e) => setCustomerText(e.target.value)}
                  rows={3}
                  placeholder="Who buys this? What do they care about?"
                  className={`${FIELD_CLASS} resize-none`}
                  style={radiusStyle}
                />
              </div>
              <div>
                <label htmlFor="check-in-exclusions" className={labelClass}>
                  Exclusions
                </label>
                <textarea
                  id="check-in-exclusions"
                  value={exclusionsText}
                  onChange={(e) => setExclusionsText(e.target.value)}
                  rows={2}
                  placeholder="Competitors we shouldn't appear next to, topics to avoid."
                  className={`${FIELD_CLASS} resize-none`}
                  style={radiusStyle}
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
                className="inline-flex items-center gap-2 bg-[var(--ts-ink-on-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90"
                style={radiusStyle}
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
        className="mt-4 text-sm font-medium text-[var(--ts-accent)] hover:underline"
      >
        Actually, treat this as a new brief →
      </button>
    </div>
  );
}
