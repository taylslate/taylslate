"use client";

// Wave 14 Phase 2A Layer 3 — brief intake form.
//
// Three sections: Product (URL → AI derivation → editable read-back card),
// Customer (free text — the brand's 30 seconds of customer truth), and
// Campaign (the actual decisions: goals, budget, flight, exclusions).
// Submit creates/updates the campaign row and hands off to the
// interpretation flow (Layers 4-5).
//
// Returning brands (prior campaign_patterns row) see a check-in instead of
// the full form — see returning-check-in.tsx.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  BriefFlight,
  BriefFlightPreset,
  BriefGoal,
  ProductDerivation,
} from "@/lib/data/types";
import ProductSection, { type ProductState } from "./product-section";
import ReturningCheckIn from "./returning-check-in";

export interface ReturningContext {
  patternId: string;
  previousSummary: string | null;
}

interface Props {
  prefillUrl: string;
  initialDraftId: string | null;
  returning: ReturningContext | null;
}

const MAX_GOALS = 3;

const GOAL_OPTIONS: { value: BriefGoal; label: string }[] = [
  { value: "test_channel", label: "Test the channel" },
  { value: "scale_winner", label: "Scale a winner" },
  { value: "direct_response", label: "Direct response" },
  { value: "brand_awareness", label: "Brand awareness" },
  { value: "lead_gen", label: "Lead gen" },
];

/** "Q3 2026"-style label for the quarter after the current one. */
export function nextQuarterLabel(now: Date = new Date()): string {
  const quarter = Math.floor(now.getMonth() / 3) + 1; // 1-4
  if (quarter === 4) return `Q1 ${now.getFullYear() + 1}`;
  return `Q${quarter + 1} ${now.getFullYear()}`;
}

type FlightChoice = BriefFlightPreset | "dates";

export default function BriefIntakeForm({
  prefillUrl,
  initialDraftId,
  returning,
}: Props) {
  const router = useRouter();

  // Returning-brand mode. 'checkin' shows the welcome-back card;
  // 'decisions' is the post-check-in state (Section 3 only, sections 1-2
  // silently reuse the prior pattern); 'full' is the first-time form,
  // also reachable via the "treat as new brief" escape hatch.
  const [mode, setMode] = useState<"checkin" | "decisions" | "full">(
    returning ? "checkin" : "full"
  );
  const [deltaText, setDeltaText] = useState<string | null>(null);

  const [campaignId, setCampaignId] = useState<string | null>(initialDraftId);
  const draftPromiseRef = useRef<Promise<string | null> | null>(null);

  // Section 1 — product (state owned here, rendered by ProductSection)
  const [product, setProduct] = useState<ProductState>({
    url: prefillUrl,
    paragraph: "",
    fallbackMode: false,
    derivation: null,
    source: "url",
    deriving: false,
    deriveError: null,
  });

  // Section 2 — customer
  const [customerText, setCustomerText] = useState("");

  // Section 3 — campaign decisions
  const [goals, setGoals] = useState<Set<BriefGoal>>(new Set());
  const [goalsContext, setGoalsContext] = useState("");
  const [budget, setBudget] = useState("");
  const [flightChoice, setFlightChoice] = useState<FlightChoice | null>(null);
  const [flightStart, setFlightStart] = useState("");
  const [flightEnd, setFlightEnd] = useState("");
  const [exclusions, setExclusions] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The derive-product endpoint is scoped to a campaign, so a draft row
   * must exist before the first derivation. Single in-flight promise so a
   * blur + click can't double-create.
   */
  const ensureDraft = (): Promise<string | null> => {
    if (campaignId) return Promise.resolve(campaignId);
    if (!draftPromiseRef.current) {
      draftPromiseRef.current = fetch("/api/campaigns/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "draft" }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (typeof data.campaign_id === "string") {
            setCampaignId(data.campaign_id);
            return data.campaign_id as string;
          }
          draftPromiseRef.current = null;
          return null;
        })
        .catch(() => {
          draftPromiseRef.current = null;
          return null;
        });
    }
    return draftPromiseRef.current;
  };

  const deriveProduct = async (input: { url?: string; paragraph?: string }) => {
    setProduct((p) => ({ ...p, deriving: true, deriveError: null }));
    const id = await ensureDraft();
    if (!id) {
      setProduct((p) => ({
        ...p,
        deriving: false,
        deriveError: "Couldn't start the campaign. Try again.",
      }));
      return;
    }
    try {
      const res = await fetch(`/api/campaigns/${id}/derive-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (data.error === "url_unreachable") {
        setProduct((p) => ({
          ...p,
          deriving: false,
          fallbackMode: true,
          deriveError: null,
        }));
        return;
      }
      if (data.error) {
        setProduct((p) => ({
          ...p,
          deriving: false,
          fallbackMode: true,
          deriveError:
            "We hit an issue reading that. Paste a short description instead.",
        }));
        return;
      }
      setProduct((p) => ({
        ...p,
        deriving: false,
        derivation: data as ProductDerivation,
        source: input.url ? "url" : "paragraph",
      }));
    } catch {
      setProduct((p) => ({
        ...p,
        deriving: false,
        deriveError: "Network error. Try again.",
      }));
    }
  };

  const toggleGoal = (goal: BriefGoal) => {
    setGoals((prev) => {
      const next = new Set(prev);
      if (next.has(goal)) next.delete(goal);
      else if (next.size < MAX_GOALS) next.add(goal);
      return next;
    });
  };

  const buildFlight = (): BriefFlight | null => {
    if (!flightChoice) return null;
    if (flightChoice === "dates") {
      if (!flightStart || !flightEnd) return null;
      return { mode: "dates", start_date: flightStart, end_date: flightEnd };
    }
    return { mode: "preset", preset: flightChoice };
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const reusing = mode === "decisions" && returning;

    if (!reusing && !product.derivation) {
      setError(
        "Add your product URL (or paste a description) so we can read what you sell."
      );
      return;
    }
    if (!reusing && !customerText.trim()) {
      setError("Tell us about your customer — that's the part we can't infer.");
      return;
    }
    if (goals.size === 0) {
      setError("Pick at least one campaign goal.");
      return;
    }
    const budgetNumber = Number(budget);
    if (!budgetNumber || budgetNumber < 5000) {
      setError("Budget must be at least $5,000.");
      return;
    }
    const flight = buildFlight();
    if (!flight) {
      setError("Pick a flight window.");
      return;
    }

    setIsSubmitting(true);

    const body: Record<string, unknown> = {
      stage: "submit",
      campaign_id: campaignId ?? undefined,
      goals: Array.from(goals),
      goals_context: goalsContext.trim() || undefined,
      budget_total: budgetNumber,
      flight,
      exclusions_text: exclusions.trim() || undefined,
    };

    if (reusing) {
      body.customer_context = {
        reused_from_pattern_id: returning.patternId,
        ...(deltaText ? { delta_text: deltaText } : {}),
      };
    } else {
      body.product = {
        ...product.derivation,
        source: product.source,
        url: product.source === "url" ? product.url.trim() || null : null,
      };
      body.customer_text = customerText.trim();
    }

    try {
      const res = await fetch("/api/campaigns/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setIsSubmitting(false);
        return;
      }
      router.push(`/campaigns/${data.campaign_id}/interpretation`);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setIsSubmitting(false);
    }
  };

  // ---- Returning-brand check-in ----

  if (mode === "checkin" && returning) {
    return (
      <ReturningCheckIn
        previousSummary={returning.previousSummary}
        onNothingChanged={() => {
          setDeltaText(null);
          setMode("decisions");
        }}
        onDelta={(delta) => {
          setDeltaText(delta);
          setMode("decisions");
        }}
        onStartFresh={() => setMode("full")}
      />
    );
  }

  const reusing = mode === "decisions" && returning;

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <button
          onClick={() => (reusing ? setMode("checkin") : router.back())}
          className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-4"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
          New Campaign
        </h1>
        <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
          {reusing
            ? "Just the campaign decisions — we'll reuse what we know about your product and customer."
            : "Thirty seconds of truth from you; we'll do the reading."}
        </p>
      </div>

      {/* noValidate: validation is handled in handleSubmit with inline
          errors; native bubbles would double up. */}
      <form onSubmit={handleSubmit} noValidate className="space-y-10">
        {!reusing && (
          <>
            {/* ---- Section 1: Product ---- */}
            <section aria-labelledby="section-product">
              <SectionHeading
                id="section-product"
                index={1}
                title="Product"
                hint="Your URL is enough — we'll read it and play it back."
              />
              <ProductSection
                state={product}
                onChange={setProduct}
                onDerive={deriveProduct}
              />
            </section>

            {/* ---- Section 2: Customer ---- */}
            <section aria-labelledby="section-customer">
              <SectionHeading
                id="section-customer"
                index={2}
                title="Customer"
                hint="Tell us about your customer in your own words."
              />
              <textarea
                value={customerText}
                onChange={(e) => setCustomerText(e.target.value)}
                rows={4}
                placeholder="Who buys this? What do they care about? What's worked before?"
                className="w-full px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
              />
            </section>
          </>
        )}

        {reusing && deltaText && (
          <div className="p-4 rounded-xl border border-[var(--brand-teal)]/40 bg-[var(--brand-teal)]/[0.05] text-sm text-[var(--brand-text-secondary)]">
            <span className="font-semibold text-[var(--brand-text)]">
              What&rsquo;s changed:
            </span>{" "}
            {deltaText}
          </div>
        )}

        {/* ---- Section 3: Campaign ---- */}
        <section aria-labelledby="section-campaign">
          <SectionHeading
            id="section-campaign"
            index={reusing ? 1 : 3}
            title="Campaign"
            hint="The decisions only you can make."
          />

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">
                Goals
              </label>
              <div className="flex flex-wrap gap-2">
                {GOAL_OPTIONS.map((opt) => {
                  const selected = goals.has(opt.value);
                  const disabled = !selected && goals.size >= MAX_GOALS;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() => toggleGoal(opt.value)}
                      className={`px-3.5 py-2 rounded-lg border text-sm font-semibold transition-all ${
                        selected
                          ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                          : disabled
                            ? "border-[var(--brand-border)] bg-[var(--brand-surface)] opacity-40 cursor-not-allowed text-[var(--brand-text-muted)]"
                            : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/30"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--brand-text-muted)] mt-2">
                {goals.size} of {MAX_GOALS} selected
              </p>
              <input
                type="text"
                value={goalsContext}
                onChange={(e) => setGoalsContext(e.target.value)}
                placeholder="Anything we should know about these goals?"
                className="mt-2 w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
              />
            </div>

            <div>
              <label
                htmlFor="budget-input"
                className="block text-sm font-medium text-[var(--brand-text)] mb-1.5"
              >
                Budget (USD)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">
                  $
                </span>
                <input
                  id="budget-input"
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  required
                  min="5000"
                  step="1000"
                  placeholder="25000"
                  className="w-full pl-8 pr-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
                />
              </div>
              <p className="text-xs text-[var(--brand-text-muted)] mt-1.5">
                Minimum $5,000 — enough for a meaningful 3-spot test across a
                few shows.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">
                Flight window
              </label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { value: "asap", label: "ASAP" },
                    { value: "next_30_days", label: "Next 30 days" },
                    { value: "next_60_days", label: "Next 60 days" },
                    { value: "next_quarter", label: nextQuarterLabel() },
                    { value: "dates", label: "Pick dates" },
                  ] as { value: FlightChoice; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={flightChoice === opt.value}
                    onClick={() => setFlightChoice(opt.value)}
                    className={`px-3.5 py-2 rounded-lg border text-sm font-semibold transition-all ${
                      flightChoice === opt.value
                        ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                        : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/30"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {flightChoice === "dates" && (
                <div className="flex items-center gap-3 mt-3">
                  <input
                    type="date"
                    aria-label="Flight start date"
                    value={flightStart}
                    onChange={(e) => setFlightStart(e.target.value)}
                    className="px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
                  />
                  <span className="text-sm text-[var(--brand-text-muted)]">to</span>
                  <input
                    type="date"
                    aria-label="Flight end date"
                    value={flightEnd}
                    onChange={(e) => setFlightEnd(e.target.value)}
                    className="px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">
                Exclusions
              </label>
              <textarea
                value={exclusions}
                onChange={(e) => setExclusions(e.target.value)}
                rows={2}
                placeholder="Competitors we shouldn't appear next to, topics we want to avoid."
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
              />
            </div>
          </div>
        </section>

        <div className="border-t border-[var(--brand-border)] pt-6">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl text-sm font-semibold transition-all"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Reading your brief...
              </>
            ) : (
              <>See how I&rsquo;m reading this →</>
            )}
          </button>
          {error && (
            <div
              role="alert"
              className="mt-4 p-3 rounded-lg border border-[var(--brand-error)]/30 bg-[var(--brand-error)]/[0.04] text-sm text-[var(--brand-error)]"
            >
              {error}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

function SectionHeading({
  id,
  index,
  title,
  hint,
}: {
  id: string;
  index: number;
  title: string;
  hint: string;
}) {
  return (
    <div className="mb-4">
      <h2
        id={id}
        className="flex items-center gap-2 text-base font-bold text-[var(--brand-text)]"
      >
        <span className="w-6 h-6 rounded-full bg-[var(--brand-blue)]/[0.08] text-[var(--brand-blue)] text-xs font-bold flex items-center justify-center">
          {index}
        </span>
        {title}
      </h2>
      <p className="text-xs text-[var(--brand-text-muted)] mt-1 ml-8">{hint}</p>
    </div>
  );
}
