"use client";

// Wave 14 Phase 2A Layer 5 — interpretation page client.
//
// Three zones on one page, no modals:
//   A — primary read: customer summary + the primary ring (refinable)
//   B — lateral rings: Include / Skip / Refine, plus "add a ring I missed"
//   C — confirm: writes brand decisions and hands off to discovery
//
// Reload is durable: the server reconstructs current ring state from
// ring_hypotheses (see lib/discovery/interpretation-state.ts) and passes it
// as initialInterpretation. Only the first visit (no pattern yet) POSTs
// /interpret to run the interpretation fresh. The per-slot refine counter is
// session-only UI state and resetting on reload is fine — the rings are
// durable.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tokens } from "@/lib/brand/tokens";
import type {
  BrandDecision,
  BriefGoal,
  BriefInterpretation,
  ConvictionBand,
  InterpretedRing,
} from "@/lib/data/types";

const MAX_REFINEMENTS = 3;

const radiusStyle = { borderRadius: tokens.radius };

const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none resize-none";

const inkBtnClass =
  "inline-flex items-center justify-center gap-2 bg-[var(--ts-ink-on-paper)] text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

const alertClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-sm text-[var(--ts-ink-on-paper)]";

const mutedText = "text-[var(--ts-ink-muted-on-paper)]";

const accentLinkClass =
  "font-medium text-[var(--ts-accent)] hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-40";

const GOAL_LABELS: Record<BriefGoal, string> = {
  test_channel: "test-the-channel",
  scale_winner: "scale-a-winner",
  direct_response: "direct-response",
  brand_awareness: "brand-awareness",
  lead_gen: "lead-gen",
};

interface RingSlot {
  /** Stable client id so a refine swap keeps the same slot + counter. */
  slotId: string;
  ring: InterpretedRing;
  include: boolean;
  addedByBrand: boolean;
  refineCount: number;
}

interface Props {
  campaignId: string;
  budgetTotal: number | null;
  goals: BriefGoal[];
  prefillUrl: string;
  /** Reconstructed-from-DB interpretation; null on first visit. */
  initialInterpretation: BriefInterpretation | null;
  /** ring_hypothesis_id → persisted brand_decision (durable defaults). */
  initialDecisions: Record<string, BrandDecision> | null;
  /**
   * A pattern row exists but reconstruction produced no usable rings (a save
   * that left nothing replayable). Distinct from first visit (no pattern):
   * the page must NOT re-run a fresh interpretation, it must show the
   * "couldn't save — refresh" banner with every CTA disabled.
   */
  patternEmpty: boolean;
}

function includeFromConfidence(c: ConvictionBand): boolean {
  return c === "high" || c === "medium";
}

/** Seed a lateral's Include/Skip + added marker from persisted state. */
function lateralSlot(
  ring: InterpretedRing,
  index: number,
  decisions: Record<string, BrandDecision> | null
): RingSlot {
  const decision = ring.ring_hypothesis_id
    ? decisions?.[ring.ring_hypothesis_id]
    : undefined;
  const addedByBrand = decision === "added_by_brand";
  let include: boolean;
  if (decision === "confirmed" || decision === "added_by_brand") include = true;
  else if (decision === "rejected") include = false;
  else include = includeFromConfidence(ring.confidence);
  return {
    slotId: `lateral-${index}`,
    ring,
    include,
    addedByBrand,
    refineCount: 0,
  };
}

function buildSlots(
  interp: BriefInterpretation,
  decisions: Record<string, BrandDecision> | null
): { primary: RingSlot; laterals: RingSlot[] } {
  return {
    primary: {
      slotId: "primary",
      ring: interp.primary_ring,
      include: true, // the primary read is always part of the campaign
      addedByBrand: false,
      refineCount: 0,
    },
    laterals: interp.lateral_rings.map((r, i) => lateralSlot(r, i, decisions)),
  };
}

export default function InterpretationClient({
  campaignId,
  budgetTotal,
  goals,
  prefillUrl,
  initialInterpretation,
  initialDecisions,
  patternEmpty,
}: Props) {
  const router = useRouter();

  const [interpretation, setInterpretation] = useState<BriefInterpretation | null>(
    initialInterpretation
  );
  // No spinner when we already know the pattern is empty — go straight to the
  // banner. Only a genuine first visit (no pattern, not empty) interprets.
  const [loading, setLoading] = useState(!initialInterpretation && !patternEmpty);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Pattern exists but has no usable rings — render the refresh banner with
  // CTAs disabled. Set true either from the server (patternEmpty) or after a
  // fresh interpret returns a blob with no primary ring.
  const [emptyRings, setEmptyRings] = useState(patternEmpty);
  // Refine/add fetches in flight, lifted to the page so Confirm can't fire
  // mid-mutation (a refine swap or add must land before the brand confirms).
  const [refinesInFlight, setRefinesInFlight] = useState(0);
  const onRefiningChange = (active: boolean) =>
    setRefinesInFlight((n) => (active ? n + 1 : Math.max(0, n - 1)));

  const [primary, setPrimary] = useState<RingSlot | null>(() =>
    initialInterpretation
      ? buildSlots(initialInterpretation, initialDecisions).primary
      : null
  );
  const [laterals, setLaterals] = useState<RingSlot[]>(() =>
    initialInterpretation
      ? buildSlots(initialInterpretation, initialDecisions).laterals
      : []
  );
  const addedCounter = useRef(0);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // First visit only: run the interpretation. A double-fired effect is safe —
  // the /interpret endpoint is idempotent (lock + replay).
  const ran = useRef(false);
  useEffect(() => {
    // Skip the fresh interpret on a durable reload AND on an empty pattern —
    // re-running would overwrite (or replay onto) a pattern that already exists.
    if (initialInterpretation || patternEmpty || ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/interpret`, {
          method: "POST",
        });
        const data = await res.json();
        if (data?.error) {
          setLoadError(
            data.code === "NO_API_KEY"
              ? "AI interpretation isn't configured yet. Add an ANTHROPIC_API_KEY and refresh."
              : data.reason === "in_progress"
                ? "Still reading your brief — refresh in a moment."
                : "We hit an issue interpreting your brief. Refresh to try again."
          );
          setLoading(false);
          return;
        }
        const interp = data as BriefInterpretation;
        // A blob with no usable primary ring is an empty interpretation —
        // surface the refresh banner instead of a broken page.
        if (!interp.primary_ring?.ring_label) {
          setEmptyRings(true);
          setLoading(false);
          return;
        }
        const slots = buildSlots(interp, null);
        setInterpretation(interp);
        setPrimary(slots.primary);
        setLaterals(slots.laterals);
        setLoading(false);
      } catch {
        setLoadError("Network error. Refresh to try again.");
        setLoading(false);
      }
    })();
  }, [campaignId, initialInterpretation, patternEmpty]);

  if (loading) {
    return (
      <Shell>
        <p className={`animate-pulse text-sm ${mutedText}`}>
          Reading your brief…
        </p>
      </Shell>
    );
  }

  // Pattern exists but produced no usable rings. Same guard pattern as
  // persistenceFailed: show the refresh banner with every CTA disabled. There
  // are no rings to refine and nothing to add into, so only a disabled Confirm
  // is rendered.
  if (emptyRings) {
    return (
      <Shell>
        <div role="alert" className={`mb-6 p-4 ${alertClass}`} style={radiusStyle}>
          We read your brief but couldn&rsquo;t save the interpretation. Refresh
          to try again.
        </div>
        <button
          type="button"
          disabled
          className={`w-full py-3 text-sm font-medium ${inkBtnClass}`}
          style={radiusStyle}
        >
          Confirm interpretation and discover shows
        </button>
      </Shell>
    );
  }

  if (loadError || !interpretation || !primary) {
    return (
      <Shell>
        <div role="alert" className={`p-4 ${alertClass}`} style={radiusStyle}>
          {loadError ?? "We couldn't load this interpretation. Refresh to try again."}
        </div>
      </Shell>
    );
  }

  // Fail-soft guard: Layer 4 persistence failed, so there are no ring ids to
  // write decisions against. Render read-only with a refresh banner.
  const persistenceFailed = interpretation.campaign_pattern_id === null;

  const cp = interpretation.campaign_pattern;
  const allRings = [primary, ...laterals];
  const speculativeAll =
    cp.interpretation_confidence === "speculative" &&
    allRings.every(
      (s) => s.ring.confidence === "speculative" || s.ring.confidence === "low"
    );

  const confirmedCount =
    1 /* primary */ + laterals.filter((s) => s.include).length;
  const goalLabel = goals.length > 0 ? GOAL_LABELS[goals[0]] : null;

  // ---- mutations ----

  const applyRefine = (slotId: string, newRing: InterpretedRing) => {
    if (slotId === "primary") {
      setPrimary((p) =>
        p ? { ...p, ring: newRing, refineCount: p.refineCount + 1 } : p
      );
    } else {
      setLaterals((rows) =>
        rows.map((s) =>
          s.slotId === slotId
            ? { ...s, ring: newRing, refineCount: s.refineCount + 1 }
            : s
        )
      );
    }
  };

  const setInclude = (slotId: string, include: boolean) =>
    setLaterals((rows) =>
      rows.map((s) => (s.slotId === slotId ? { ...s, include } : s))
    );

  const appendAddedRing = (ring: InterpretedRing) => {
    const slotId = `added-${addedCounter.current++}`;
    setLaterals((rows) => [
      ...rows,
      { slotId, ring, include: true, addedByBrand: true, refineCount: 0 },
    ]);
  };

  const handleConfirm = async () => {
    setConfirmError(null);
    setConfirming(true);
    const rings: Array<{ id: string; decision: BrandDecision }> = [];
    if (primary.ring.ring_hypothesis_id) {
      rings.push({ id: primary.ring.ring_hypothesis_id, decision: "confirmed" });
    }
    for (const s of laterals) {
      if (!s.ring.ring_hypothesis_id) continue;
      const decision: BrandDecision = !s.include
        ? "rejected"
        : s.addedByBrand
          ? "added_by_brand"
          : "confirmed";
      rings.push({ id: s.ring.ring_hypothesis_id, decision });
    }
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/interpret/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rings }),
      });
      if (!res.ok) {
        setConfirmError("Couldn't confirm. Please try again.");
        setConfirming(false);
        return;
      }
      router.push(`/campaigns/${campaignId}`);
    } catch {
      setConfirmError("Network error. Please try again.");
      setConfirming(false);
    }
  };

  const startOverHref = `/campaigns/new${
    prefillUrl ? `?url=${encodeURIComponent(prefillUrl)}` : ""
  }`;

  return (
    <Shell>
      {persistenceFailed && (
        <div role="alert" className={`mb-6 p-4 ${alertClass}`} style={radiusStyle}>
          We read your brief but couldn&rsquo;t save the interpretation. You can
          review it below — refresh to save and continue.
        </div>
      )}

      {/* ---- Zone A: primary read ---- */}
      <section aria-labelledby="zone-primary" className="mb-8">
        <h2 id="zone-primary" className="sr-only">
          How we&rsquo;re reading your brief
        </h2>
        <p className={`mb-2 text-xs font-medium uppercase tracking-wide ${mutedText}`}>
          Here&rsquo;s how I&rsquo;m reading this
        </p>
        <p
          data-testid="customer-summary"
          className="text-lg leading-relaxed"
        >
          {speculativeAll
            ? "I'm reasoning from first principles here — no strong analogs in the library yet. "
            : ""}
          {cp.customer_summary}
        </p>

        <RingCard
          slot={primary}
          isPrimary
          disabled={persistenceFailed}
          campaignId={campaignId}
          startOverHref={startOverHref}
          onRefined={applyRefine}
          onRefiningChange={onRefiningChange}
        />
      </section>

      {/* ---- Zone B: lateral rings ---- */}
      <section aria-labelledby="zone-laterals" className="mb-8">
        <h2
          id="zone-laterals"
          className="mb-1 text-base font-semibold"
        >
          Other rings worth a look
        </h2>
        <p className={`mb-4 text-xs ${mutedText}`}>
          Include the frames you want to discover against. Skip the ones that
          don&rsquo;t fit. Refine any read that&rsquo;s off.
        </p>

        <div className="space-y-3">
          {laterals.map((slot) => (
            <RingCard
              key={slot.slotId}
              slot={slot}
              disabled={persistenceFailed}
              campaignId={campaignId}
              startOverHref={startOverHref}
              onRefined={applyRefine}
              onInclude={setInclude}
              onRefiningChange={onRefiningChange}
            />
          ))}
          {laterals.length === 0 && (
            <p className={`text-sm italic ${mutedText}`}>
              No lateral rings — the primary read stands on its own.
            </p>
          )}
        </div>

        <AddRing
          campaignId={campaignId}
          disabled={persistenceFailed}
          onAdded={appendAddedRing}
          onRefiningChange={onRefiningChange}
        />
      </section>

      {/* ---- Zone C: confirm ---- */}
      <section
        aria-labelledby="zone-confirm"
        className="border-t border-[var(--ts-hairline-on-paper)] pt-6"
      >
        <h2 id="zone-confirm" className="sr-only">
          Confirm and discover
        </h2>
        <p
          data-testid="confirm-summary"
          className={`mb-4 text-sm ${mutedText}`}
        >
          {speculativeAll
            ? "Low confidence on this brief. Worth treating as a small test before scaling. "
            : ""}
          Discovering shows across{" "}
          <span className="font-semibold text-[var(--ts-ink-on-paper)]">
            {confirmedCount} confirmed ring{confirmedCount === 1 ? "" : "s"}
          </span>
          {budgetTotal !== null && (
            <>
              {" "}
              within your{" "}
              <span className="font-semibold text-[var(--ts-ink-on-paper)]">
                ${budgetTotal.toLocaleString("en-US")}
              </span>
              {goalLabel ? ` ${goalLabel}` : ""} budget
            </>
          )}
          .
        </p>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={confirming || persistenceFailed || refinesInFlight > 0}
          className={`w-full py-3 text-sm font-medium ${inkBtnClass}`}
          style={radiusStyle}
        >
          {confirming ? (
            <span className="animate-pulse">Confirming…</span>
          ) : (
            "Confirm interpretation and discover shows"
          )}
        </button>
        {confirmError && (
          <div role="alert" className={`mt-3 p-3 ${alertClass}`} style={radiusStyle}>
            {confirmError}
          </div>
        )}
      </section>
    </Shell>
  );
}

// ============================================================
// Ring card (primary + lateral) with inline refinement
// ============================================================

function RingCard({
  slot,
  isPrimary = false,
  disabled,
  campaignId,
  startOverHref,
  onRefined,
  onInclude,
  onRefiningChange,
}: {
  slot: RingSlot;
  isPrimary?: boolean;
  disabled: boolean;
  campaignId: string;
  startOverHref: string;
  onRefined: (slotId: string, ring: InterpretedRing) => void;
  onInclude?: (slotId: string, include: boolean) => void;
  /** Notify the page that a refine fetch started (true) / ended (false). */
  onRefiningChange: (active: boolean) => void;
}) {
  const [refineOpen, setRefineOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxedOut = slot.refineCount >= MAX_REFINEMENTS;
  const noId = !slot.ring.ring_hypothesis_id;

  // Abort an in-flight refine if the card unmounts (navigation away mid-fetch),
  // so the resolve handler can't setState on an unmounted component.
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const submitRefine = async () => {
    // Enforce the cap here too, not just by disabling the button.
    if (!text.trim() || !slot.ring.ring_hypothesis_id || maxedOut) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitting(true);
    setError(null);
    onRefiningChange(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/interpret/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ring_hypothesis_id: slot.ring.ring_hypothesis_id,
          refinement_text: text.trim(),
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (data?.error || !data?.ring) {
        setError("Couldn't refine that. Try rephrasing.");
        setSubmitting(false);
        onRefiningChange(false);
        return;
      }
      onRefined(slot.slotId, data.ring as InterpretedRing);
      setText("");
      setRefineOpen(false);
      setSubmitting(false);
      onRefiningChange(false);
    } catch {
      // Aborted on unmount — the component is gone, skip all state updates.
      if (controller.signal.aborted) return;
      setError("Network error. Try again.");
      setSubmitting(false);
      onRefiningChange(false);
    }
  };

  return (
    <div
      data-testid={isPrimary ? "primary-ring-card" : "lateral-ring-card"}
      className={`mt-4 border p-5 ${
        isPrimary || slot.include
          ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)]"
          : "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] opacity-60"
      }`}
      style={radiusStyle}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold">
            {slot.ring.ring_label}
          </span>
          <ConfidenceBadge confidence={slot.ring.confidence} />
          {slot.addedByBrand && (
            <span
              className="border border-[var(--ts-hairline-on-paper)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ts-accent)]"
              style={radiusStyle}
            >
              You added this
            </span>
          )}
        </div>
      </div>

      <p className={`mt-2 text-sm leading-relaxed ${mutedText}`}>
        {slot.ring.reasoning}
      </p>

      {slot.ring.analog_campaigns.length > 0 && (
        <p className={`mt-2 text-xs ${mutedText}`}>
          Drawing on{" "}
          {slot.ring.analog_campaigns.map((a, i) => (
            <span key={a}>
              {i > 0 && ", "}
              <span className="font-semibold text-[var(--ts-ink-on-paper)]">
                {a}
              </span>
            </span>
          ))}
          .
        </p>
      )}

      {/* controls */}
      <div className="mt-4 flex items-center gap-2">
        {!isPrimary && onInclude && (
          <>
            <ToggleButton
              label="Include"
              active={slot.include}
              disabled={disabled}
              onClick={() => onInclude(slot.slotId, true)}
            />
            <ToggleButton
              label="Skip"
              active={!slot.include}
              disabled={disabled}
              onClick={() => onInclude(slot.slotId, false)}
            />
          </>
        )}
        <button
          type="button"
          disabled={disabled || noId || maxedOut}
          onClick={() => setRefineOpen((v) => !v)}
          className={`ml-auto text-xs ${accentLinkClass}`}
        >
          {isPrimary ? "That’s not quite right — refine" : "Refine"}
        </button>
      </div>

      {refineOpen && (
        <div className="mt-3">
          <textarea
            aria-label={`Refine ${slot.ring.ring_label}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Tell me what's off — who's the customer really?"
            className={fieldClass}
            style={radiusStyle}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={submitRefine}
              disabled={submitting || !text.trim()}
              className={`px-3 py-1.5 text-xs font-medium ${inkBtnClass}`}
              style={radiusStyle}
            >
              {submitting ? "Re-reading…" : "Submit refinement"}
            </button>
            <span className={`text-xs ${mutedText}`}>
              {slot.refineCount} of {MAX_REFINEMENTS} refinements
            </span>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-[var(--ts-ink-on-paper)]">
              {error}
            </p>
          )}
        </div>
      )}

      {maxedOut && (
        <p className={`mt-3 text-xs ${mutedText}`}>
          Still not landing?{" "}
          <a href={startOverHref} className={accentLinkClass}>
            Want to start over?
          </a>
        </p>
      )}
    </div>
  );
}

// ============================================================
// Add a ring I missed
// ============================================================

function AddRing({
  campaignId,
  disabled,
  onAdded,
  onRefiningChange,
}: {
  campaignId: string;
  disabled: boolean;
  onAdded: (ring: InterpretedRing) => void;
  /** Notify the page that an add fetch started (true) / ended (false). */
  onRefiningChange: (active: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = async () => {
    if (!text.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSubmitting(true);
    setError(null);
    onRefiningChange(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/interpret/add-ring`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ framing_text: text.trim() }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (data?.error || !data?.ring) {
        setError("Couldn't build that ring. Try rephrasing.");
        setSubmitting(false);
        onRefiningChange(false);
        return;
      }
      onAdded(data.ring as InterpretedRing);
      setText("");
      setOpen(false);
      setSubmitting(false);
      onRefiningChange(false);
    } catch {
      if (controller.signal.aborted) return;
      setError("Network error. Try again.");
      setSubmitting(false);
      onRefiningChange(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`mt-4 text-sm ${accentLinkClass}`}
      >
        + Add a ring I missed
      </button>
    );
  }

  return (
    <div
      className="mt-4 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4"
      style={radiusStyle}
    >
      <textarea
        aria-label="Add a ring I missed"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="What audience are we missing? Frame it however you'd describe it."
        className={fieldClass}
        style={radiusStyle}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !text.trim()}
          className={`px-3 py-1.5 text-xs font-medium ${inkBtnClass}`}
          style={radiusStyle}
        >
          {submitting ? "Reading…" : "Add this ring"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={`text-xs ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--ts-ink-on-paper)]">
          {error}
        </p>
      )}
    </div>
  );
}

// ============================================================
// Presentational bits
// ============================================================

function ConfidenceBadge({ confidence }: { confidence: ConvictionBand }) {
  const tone =
    confidence === "low" || confidence === "speculative"
      ? mutedText
      : "text-[var(--ts-ink-on-paper)]";
  return (
    <span
      data-testid="confidence-badge"
      className={`border border-[var(--ts-hairline-on-paper)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
      style={radiusStyle}
    >
      {confidence}
    </span>
  );
}

function ToggleButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`border px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
        active
          ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]"
          : "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:bg-[var(--ts-band-shows)]"
      }`}
      style={radiusStyle}
    >
      {label}
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-2xl p-4 sm:p-8">
      <p className="mb-6 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]">
        For brands
      </p>
      {children}
    </div>
  );
}
