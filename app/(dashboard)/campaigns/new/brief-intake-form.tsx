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
import { tokens } from "@/lib/brand/tokens";
import type {
  BriefChangedField,
  BriefChangedFieldKey,
  BriefFlight,
  BriefFlightPreset,
  BriefGoal,
  ProductDerivation,
} from "@/lib/data/types";
import { validateFlightDates } from "@/lib/validation/flight-dates";
import ProductSection, { type ProductState } from "./product-section";
import ReturningCheckIn, {
  type CheckInDelta,
  type PriorBriefValues,
} from "./returning-check-in";

export interface ReturningContext {
  patternId: string;
  previousSummary: string | null;
  prior: PriorBriefValues;
}

interface Props {
  prefillUrl: string;
  initialDraftId: string | null;
  returning: ReturningContext | null;
}

const MAX_GOALS = 3;

const radiusStyle = { borderRadius: tokens.radius };

const controlClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";

const fieldClass = `w-full px-4 py-2.5 ${controlClass}`;

const labelClass = "mb-2 block text-sm font-medium";

const chipBase = "border px-3.5 py-2 text-sm font-medium";
const chipSelected =
  "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]";
const chipIdle =
  "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)]";
const chipDisabled =
  "cursor-not-allowed border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] opacity-40";

const CHANGED_FIELD_LABELS: Record<BriefChangedFieldKey, string> = {
  product_url: "product URL",
  customer_description: "customer description",
  exclusions: "exclusions",
};

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
  // Edited full values from the check-in's "what's changed" panel; null on
  // the "nothing has changed" fast lane. Diffed against returning.prior at
  // submit so later edits (e.g. the exclusions field below) are tracked.
  const [checkInDelta, setCheckInDelta] = useState<CheckInDelta | null>(null);

  const [campaignId, setCampaignId] = useState<string | null>(initialDraftId);
  const draftPromiseRef = useRef<Promise<string | null> | null>(null);
  // Monotonic request id for product derivation. A rapid double-edit of the
  // URL fires overlapping deriveProduct calls whose responses can resolve out
  // of order; only the latest may commit. Without this, an earlier (stale)
  // response could overwrite the current derivation and then be sent as the
  // canonical product_attributes override at submit.
  const deriveSeqRef = useRef(0);

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
    // Claim the latest slot. Any older in-flight call is now stale and must
    // not commit; this call shows the spinner because it is the latest.
    const seq = ++deriveSeqRef.current;
    const isStale = () => seq !== deriveSeqRef.current;

    setProduct((p) => ({ ...p, deriving: true, deriveError: null }));
    const id = await ensureDraft();
    if (isStale()) return;
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
      // A newer derive superseded this one while it was in flight — drop the
      // stale response rather than overwrite the current derivation.
      if (isStale()) return;
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
      if (isStale()) return;
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

  // Reuse path: the check-in changed the product URL, so the brand must
  // confirm a fresh derivation before submit. Once active, the live URL is
  // the ProductSection field (seeded from the panel, possibly edited
  // since) — mirroring how exclusions are handled.
  const reuseProductActive =
    !!checkInDelta &&
    !!returning &&
    checkInDelta.productUrl.trim().length > 0 &&
    (returning.prior.productUrl ?? "").trim() !==
      checkInDelta.productUrl.trim();
  const reuseProductUrl = reuseProductActive
    ? product.url
    : (checkInDelta?.productUrl ?? "");

  /**
   * Field-level before/after for the returning-brand delta path. Product
   * URL and customer description come from the check-in panel (product URL
   * from the live product section once a change activates it); exclusions
   * from the live Section 3 field (seeded from the panel, possibly edited
   * since). Only fields that actually changed get an entry.
   */
  const buildChangedFields = (): Partial<
    Record<BriefChangedFieldKey, BriefChangedField>
  > => {
    if (!checkInDelta || !returning) return {};
    const changed: Partial<Record<BriefChangedFieldKey, BriefChangedField>> = {};
    const compare = (
      key: BriefChangedFieldKey,
      before: string | null,
      after: string
    ) => {
      if ((before ?? "").trim() !== after.trim()) {
        changed[key] = { before, after: after.trim() || null };
      }
    };
    compare("product_url", returning.prior.productUrl, reuseProductUrl);
    compare(
      "customer_description",
      returning.prior.customerText,
      checkInDelta.customerText
    );
    compare("exclusions", returning.prior.exclusionsText, exclusions);
    return changed;
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
    if (reusing && reuseProductActive && !product.derivation) {
      setError(
        product.deriving
          ? "Still reading your new product URL — one moment."
          : "Your product URL changed — read it and confirm the playback card first."
      );
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
    if (flight.mode === "dates" && flight.start_date && flight.end_date) {
      const dateError = validateFlightDates(flight.start_date, flight.end_date);
      if (dateError) {
        setError(dateError.message);
        return;
      }
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
      const changedFields = buildChangedFields();
      if (checkInDelta && Object.keys(changedFields).length > 0) {
        // Delta path: the brief carries the new full values (customer_text,
        // exclusions_text, product_url) — Layer 4 reads those, not the
        // priors — plus the field-level changes record for audit. A changed
        // product URL also carries the brand-confirmed re-derivation, which
        // Layer 4 treats as canonical over the prior pattern's attributes.
        body.customer_context = {
          reused_from_pattern_id: returning.patternId,
          product_url: reuseProductUrl.trim() || null,
          changed_fields: changedFields,
          ...(reuseProductActive && product.derivation
            ? { product_attributes: product.derivation }
            : {}),
        };
        body.customer_text = checkInDelta.customerText || undefined;
      } else {
        // Fast lane: nothing changed (or the panel was submitted unedited).
        body.customer_context = {
          reused_from_pattern_id: returning.patternId,
        };
      }
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
        prior={returning.prior}
        onNothingChanged={() => {
          setCheckInDelta(null);
          setMode("decisions");
        }}
        onDelta={(delta) => {
          setCheckInDelta(delta);
          // The panel's exclusions become the Section 3 field — one source
          // of truth; further edits there stay tracked via buildChangedFields.
          setExclusions(delta.exclusionsText);
          // Product URL changed: re-derive from the new URL so the brand
          // confirms a fresh read-back card before submit. The confirmed
          // derivation overrides the prior pattern in Layer 4.
          const urlChanged =
            delta.productUrl.trim().length > 0 &&
            (returning.prior.productUrl ?? "").trim() !==
              delta.productUrl.trim();
          if (urlChanged) {
            setProduct((p) => ({
              ...p,
              url: delta.productUrl,
              derivation: null,
              fallbackMode: false,
              deriveError: null,
            }));
            deriveProduct({ url: delta.productUrl.trim() });
          }
          setMode("decisions");
        }}
        onStartFresh={() => setMode("full")}
      />
    );
  }

  const reusing = mode === "decisions" && returning;
  const changedFieldKeys = reusing
    ? (Object.keys(buildChangedFields()) as BriefChangedFieldKey[])
    : [];

  return (
    <div className="max-w-2xl p-4 sm:p-8">
      <div className="mb-8">
        <button
          onClick={() => (reusing ? setMode("checkin") : router.back())}
          className="mb-4 flex items-center gap-1.5 text-sm text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </button>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]">
          For brands
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          New Campaign
        </h1>
        <p className="mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">
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
                className={`${fieldClass} resize-none`}
                style={radiusStyle}
              />
            </section>
          </>
        )}

        {reusing && reuseProductActive && (
          <section aria-labelledby="section-product-update">
            <SectionHeading
              id="section-product-update"
              index={1}
              title="Product update"
              hint="Your URL changed — here's our fresh read. Correct anything that's off."
            />
            <ProductSection
              state={product}
              onChange={setProduct}
              onDerive={deriveProduct}
            />
          </section>
        )}

        {reusing && checkInDelta && changedFieldKeys.length > 0 && (
          <div
            className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4 text-sm"
            style={radiusStyle}
          >
            <span className="font-medium">Updated:</span>{" "}
            {changedFieldKeys.map((k) => CHANGED_FIELD_LABELS[k]).join(", ")}
          </div>
        )}

        {/* ---- Section 3: Campaign ---- */}
        <section aria-labelledby="section-campaign">
          <SectionHeading
            id="section-campaign"
            index={reusing ? (reuseProductActive ? 2 : 1) : 3}
            title="Campaign"
            hint="The decisions only you can make."
          />

          <div className="space-y-6">
            <div>
              <label className={labelClass}>Goals</label>
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
                      className={`${chipBase} ${
                        selected ? chipSelected : disabled ? chipDisabled : chipIdle
                      }`}
                      style={radiusStyle}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
                {goals.size} of {MAX_GOALS} selected
              </p>
              <input
                type="text"
                value={goalsContext}
                onChange={(e) => setGoalsContext(e.target.value)}
                placeholder="Anything we should know about these goals?"
                className={`mt-2 ${fieldClass}`}
                style={radiusStyle}
              />
            </div>

            <div>
              <label
                htmlFor="budget-input"
                className={labelClass}
              >
                Budget (USD)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--ts-ink-muted-on-paper)]">
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
                  className={`w-full py-2.5 pl-8 pr-4 ${controlClass}`}
                  style={radiusStyle}
                />
              </div>
              <p className="mt-1.5 text-xs text-[var(--ts-ink-muted-on-paper)]">
                Minimum $5,000 — enough for a meaningful 3-spot test across a
                few shows.
              </p>
            </div>

            <div>
              <label className={labelClass}>Flight window</label>
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
                    className={`${chipBase} ${
                      flightChoice === opt.value ? chipSelected : chipIdle
                    }`}
                    style={radiusStyle}
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
                    className={`px-4 py-2.5 ${controlClass}`}
                    style={radiusStyle}
                  />
                  <span className="text-sm text-[var(--ts-ink-muted-on-paper)]">to</span>
                  <input
                    type="date"
                    aria-label="Flight end date"
                    value={flightEnd}
                    onChange={(e) => setFlightEnd(e.target.value)}
                    className={`px-4 py-2.5 ${controlClass}`}
                    style={radiusStyle}
                  />
                </div>
              )}
            </div>

            <div>
              <label className={labelClass}>Exclusions</label>
              <textarea
                value={exclusions}
                onChange={(e) => setExclusions(e.target.value)}
                rows={2}
                placeholder="Competitors we shouldn't appear next to, topics we want to avoid."
                className={`${fieldClass} resize-none`}
                style={radiusStyle}
              />
            </div>
          </div>
        </section>

        <div className="border-t border-[var(--ts-hairline-on-paper)] pt-6">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 bg-[var(--ts-ink-on-paper)] py-3 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={radiusStyle}
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
              className="mt-4 text-sm text-[var(--ts-ink-on-paper)]"
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
        className="text-base font-semibold"
      >
        <span className="mr-2 text-xs font-medium text-[var(--ts-ink-muted-on-paper)]">
          {index}
        </span>
        {title}
      </h2>
      <p className="mt-1 text-xs text-[var(--ts-ink-muted-on-paper)]">{hint}</p>
    </div>
  );
}
