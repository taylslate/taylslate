"use client";

// Wave 12 deal detail — IO preview iframe + sign / cancel actions.
// Server-rendered shell loads the deal; this client hosts interactivity.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { Wave12Deal, Wave12DealStatus } from "@/lib/data/types";
import { derivePromoCode } from "@/lib/io/promo-code";
import { formatDateOnly } from "@/lib/format/date-only";
import { tokens } from "@/lib/brand/tokens";

interface Props {
  deal: Wave12Deal;
  showName: string;
  brandName: string;
  /** "brand" | "show" — drives which actions render. */
  viewerRole: "brand" | "show";
  /**
   * UTM-tagged tracking link for the show's show notes. Generated on read from
   * the brand website + deal — never persisted. Null when unavailable; render
   * nothing in that case. Read-only for both roles.
   */
  trackingLink?: string | null;
  /**
   * Ready-to-paste show-notes blurb (brand + saved promo code + tracking link).
   * Generated on read — never persisted. Null when nothing actionable; render
   * nothing in that case. Read-only for both roles (the show pastes it).
   */
  showNotesBlurb?: string | null;
}

const STATUS_LABEL: Record<Wave12DealStatus, string> = {
  planning: "Planning",
  brand_signed: "Awaiting show countersignature",
  show_signed: "Both parties signed",
  live: "Live",
  delivering: "Delivering",
  completed: "Completed",
  cancelled: "Cancelled",
};

const radiusStyle = { borderRadius: tokens.radius };

const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const accentText = "text-[var(--ts-accent)]";
const hairlineRule = "border-[var(--ts-hairline-on-paper)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const sectionHead = `mb-3 text-xs font-medium uppercase tracking-wider ${mutedText}`;
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]";
const inkBtnClass =
  "inline-flex w-full items-center justify-center bg-[var(--ts-ink-on-paper)] px-4 py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "inline-flex items-center justify-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";

// Quiet paper washes. Same vocabulary as outreach status chips.
const STATUS_COLOR: Record<Wave12DealStatus, string> = {
  planning: "bg-[var(--ts-band-shows)] text-[var(--ts-ink-muted-on-paper)]",
  brand_signed: "bg-[var(--ts-band-shows)] text-[var(--ts-ink-on-paper)]",
  show_signed: "bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]",
  live: "bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]",
  delivering: "bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]",
  completed: "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)]",
  cancelled: "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)]",
};

function fmt(d?: string | null): string {
  if (!d) return "—";
  // Signed/cancelled timestamps rendered as a calendar date. Kept in UTC so they
  // read consistently with the flight dates above (which use formatDateOnly).
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function DealCardSetupForm({
  clientSecret,
  onSaved,
}: {
  clientSecret: string;
  onSaved: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    const card = elements.getElement(CardElement);
    if (!card) return;

    setSaving(true);
    setError(null);
    const { error: setupError } = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card },
    });
    if (setupError) {
      setError(setupError.message ?? "Couldn't save this card.");
      setSaving(false);
      return;
    }

    onSaved();
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3">
      <div className={`px-3 py-3 ${panelClass}`} style={radiusStyle}>
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "14px",
                // Stripe paints this field in a cross-origin iframe, so it
                // cannot read --ts-* variables. Matches --ts-ink-on-paper
                // and --ts-ink-muted-on-paper.
                color: "#1c1915",
                "::placeholder": { color: "#5c564c" },
              },
            },
          }}
        />
      </div>
      <button
        type="submit"
        disabled={!stripe || saving}
        className={inkBtnClass}
        style={radiusStyle}
      >
        {saving ? "Saving card..." : "Save card on file"}
      </button>
      {error && <p className={`text-sm ${accentText}`}>{error}</p>}
    </form>
  );
}

export default function Wave12DealClient({
  deal,
  showName,
  brandName,
  viewerRole,
  trackingLink,
  showNotesBlurb,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // DocuSign's hosted-signing return bounces the signer back to this page with
  // ?signing=<event> (see /api/deals/[id]/docusign-return). We read it live from
  // the URL — not a server prop — so clearing it below re-renders reactively.
  const signingParam = searchParams.get("signing");
  // "signing_complete" only means this viewer *finished in DocuSign*; the
  // authoritative *_signed_at is written asynchronously by the Connect webhook.
  // Until that lands we're still waiting on confirmation.
  const viewerSignedAt =
    viewerRole === "show" ? deal.show_signed_at : deal.brand_signed_at;
  const awaitingSignatureConfirmation =
    signingParam === "signing_complete" && !viewerSignedAt;
  const [signing, setSigning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [blurbCopied, setBlurbCopied] = useState(false);
  const [stripeInstance, setStripeInstance] = useState<Promise<Stripe | null> | null>(null);
  const [loadingStripe, setLoadingStripe] = useState(false);
  const [cardSaved, setCardSaved] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  // Recovery secret — set when the webhook-provisioned SetupIntent was missing
  // and we (re)obtained one via the deal SetupIntent route.
  const [resolvedSecret, setResolvedSecret] = useState<string | null>(null);

  // Promo code — prefill is display-only (never persisted until Save). If the
  // deal has a saved code, show it; otherwise seed the show-name slug.
  const [promoCode, setPromoCode] = useState(
    deal.promo_code ?? derivePromoCode(showName) ?? ""
  );
  const [savingPromo, setSavingPromo] = useState(false);
  const [promoSaved, setPromoSaved] = useState(false);

  // Auto-revalidate after returning from DocuSign so the signer never has to
  // manually refresh to see the signature confirmed (and, for the brand, the
  // card form unlock). The return URL is NOT authoritative — *_signed_at is set
  // by the Connect webhook a beat later. While we're awaiting that write, poll
  // the server (router.refresh re-runs the deal page's server component, which
  // re-reads the deal) every 2s, capped at 15s so a webhook that never lands
  // doesn't spin forever. Once this viewer's signed_at appears, drop the
  // transient ?signing param so a reload/back-nav doesn't restart the loop.
  useEffect(() => {
    if (signingParam !== "signing_complete") return;

    if (viewerSignedAt) {
      // Webhook confirmed. Strip the one-shot param without a server round-trip
      // or full re-render — replaceState (App-Router-synced), not router.replace.
      const url = new URL(window.location.href);
      url.searchParams.delete("signing");
      window.history.replaceState(window.history.state, "", url.toString());
      return;
    }

    const deadline = Date.now() + 15_000;
    const interval = window.setInterval(() => {
      if (Date.now() >= deadline) {
        window.clearInterval(interval);
        return;
      }
      router.refresh();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [signingParam, viewerSignedAt, router]);

  const sendToDocuSign = async () => {
    setSigning(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${deal.id}/send-to-docusign`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || !data.signing_url) {
        setError(data.error ?? "Couldn't reach DocuSign.");
        setSigning(false);
        return;
      }
      window.location.href = data.signing_url;
    } catch {
      setError("Network error — please try again.");
      setSigning(false);
    }
  };

  const savePromoCode = async () => {
    setSavingPromo(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${deal.id}/promo-code`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promo_code: promoCode.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't save promo code.");
        setSavingPromo(false);
        return;
      }
      // Reflect the normalized value the server actually stored.
      setPromoCode(data.promo_code ?? "");
      setSavingPromo(false);
      setPromoSaved(true);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
      setSavingPromo(false);
    }
  };

  const copyTrackingLink = async () => {
    if (!trackingLink) return;
    try {
      await navigator.clipboard.writeText(trackingLink);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions/insecure context) — the link is still
      // visible for manual selection, so fail quietly.
    }
  };

  const copyBlurb = async () => {
    if (!showNotesBlurb) return;
    try {
      await navigator.clipboard.writeText(showNotesBlurb);
      setBlurbCopied(true);
      window.setTimeout(() => setBlurbCopied(false), 2000);
    } catch {
      // Clipboard blocked — the blurb is still visible for manual selection.
    }
  };

  const cancelDeal = async () => {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${deal.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't cancel.");
        setCancelling(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please try again.");
      setCancelling(false);
    }
  };

  const loadPaymentForm = async () => {
    setLoadingStripe(true);
    setCardError(null);
    try {
      const cfg = await fetch("/api/stripe/config");
      const cfgData = await cfg.json();
      if (!cfg.ok || !cfgData.publishableKey) {
        throw new Error(cfgData.error ?? "Stripe is not configured.");
      }
      // Ensure a SetupIntent client secret exists. The DocuSign webhook
      // provisions one at signature time; if that didn't land (Stripe
      // unreachable then), recover it now via the deal SetupIntent route
      // rather than dead-ending on a missing secret.
      let secret = deal.setup_intent_client_secret ?? resolvedSecret;
      if (!secret) {
        const si = await fetch(`/api/deals/${deal.id}/setup-intent`, { method: "POST" });
        const siData = await si.json();
        if (si.ok && siData.status === "already_saved") {
          // Stripe already has the card (webhook lagged) — reflect it.
          setCardSaved(true);
          router.refresh();
          return;
        }
        if (!si.ok || !siData.client_secret) {
          throw new Error(siData.error ?? "Couldn't start card setup.");
        }
        secret = siData.client_secret as string;
        setResolvedSecret(secret);
      }
      setStripeInstance(loadStripe(cfgData.publishableKey));
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Couldn't load Stripe.");
    } finally {
      setLoadingStripe(false);
    }
  };

  const handleCardSaved = () => {
    setCardSaved(true);
    router.refresh();
  };

  const grossPerEp =
    deal.agreed_cpm > 0 && deal.agreed_episode_count > 0
      ? // Without audience size on the deal directly, leave the totals to the IO PDF.
        null
      : null;

  const isCancellable =
    viewerRole === "brand" && (deal.status === "planning" || deal.status === "brand_signed");
  const canSign = viewerRole === "brand" && deal.status === "planning";
  // Show countersigns in-app once the brand has signed. Status is the gate
  // (webhook flips it to show_signed); the brand viewer never sees this CTA.
  const canShowSign = viewerRole === "show" && deal.status === "brand_signed";
  // Brand can set the promo code at IO time (before signature). Otherwise the
  // stored code renders read-only — and only if one was actually saved.
  const canEditPromo = viewerRole === "brand" && deal.status === "planning";
  // Gate on brand_signed_at, not status === "brand_signed" — that mirrors the
  // server's own eligibility rule (POST /api/deals/[id]/setup-intent: "IO must be
  // signed"). A sequential brand→show envelope can reach show_signed before the
  // brand adds a card (the show may countersign first, or a one-shot
  // envelope-completed lands both signatures at once); keying off the timestamp
  // keeps the card form reachable in every post-signature state. Cancelled deals
  // never need a card.
  const needsPaymentMethod =
    viewerRole === "brand" &&
    Boolean(deal.brand_signed_at) &&
    !deal.payment_method_id &&
    deal.status !== "cancelled";
  const hasPaymentMethod = viewerRole === "brand" && Boolean(deal.payment_method_id);
  // The client secret to confirm: the webhook-stored one, or the one we
  // recovered on demand. Null until a SetupIntent exists for this deal.
  const activeCardSecret = resolvedSecret ?? deal.setup_intent_client_secret ?? null;

  return (
    <div className={`min-h-screen bg-[var(--ts-paper)] ${inkText}`}>
      <div className={`border-b ${hairlineRule} bg-[var(--ts-paper)] px-4 pt-6 pb-5 sm:px-8`}>
        <div className="mb-3 flex items-center gap-3">
          <Link
            href="/deals"
            className={`flex items-center gap-1.5 text-xs ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Deals
          </Link>
          <p className={kickerClass}>{viewerRole === "show" ? "For shows" : "For brands"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className={`text-xl font-semibold tracking-tight ${inkText}`}>
            {brandName} × {showName}
          </h1>
          <span
            className={`px-2.5 py-1 text-xs font-medium ${STATUS_COLOR[deal.status]}`}
            style={radiusStyle}
          >
            {STATUS_LABEL[deal.status]}
          </span>
        </div>
        <p className={`mt-1 text-sm ${mutedText}`}>
          Deal ID: {deal.id.slice(0, 8)}
          {deal.docusign_envelope_id ? ` · DocuSign Envelope: ${deal.docusign_envelope_id.slice(0, 8)}` : ""}
        </p>
      </div>

      <div className="px-4 py-6 sm:px-8">
      {signingParam && (
        <div className={`mb-4 p-3 text-sm ${panelClass} ${inkText}`} style={radiusStyle}>
          {awaitingSignatureConfirmation ? (
            <>Confirming your signature with DocuSign — this page updates automatically once the webhook lands…</>
          ) : (
            <>
              DocuSign signing event: <strong>{signingParam}</strong>. Webhook will update this page within a few seconds.
            </>
          )}
        </div>
      )}
      {error && (
        <div className={`mb-4 p-3 text-sm ${panelClass} ${accentText}`} style={radiusStyle}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* IO preview */}
        <div className="lg:col-span-2">
          <div className={`overflow-hidden ${panelClass}`} style={radiusStyle}>
            <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-3 ${hairlineRule}`}>
              <div className={`text-sm font-medium ${inkText}`}>Insertion Order preview</div>
              <a
                href={`/api/deals/${deal.id}/preview`}
                target="_blank"
                rel="noopener noreferrer"
                className={`text-xs font-medium ${accentText} hover:underline`}
              >
                Open in new tab
              </a>
            </div>
            <iframe
              src={`/api/deals/${deal.id}/preview`}
              title="IO preview"
              className="h-[700px] w-full bg-white"
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className={`p-5 ${panelClass}`} style={radiusStyle}>
            <h2 className={sectionHead}>
              Agreed terms
            </h2>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <Term label="CPM" value={`$${deal.agreed_cpm.toFixed(2)}`} />
              <Term label="Episodes" value={String(deal.agreed_episode_count)} />
              <Term label="Placement" value={deal.agreed_placement} />
              <Term
                label="Flight"
                value={`${formatDateOnly(deal.agreed_flight_start)} – ${formatDateOnly(deal.agreed_flight_end)}`}
              />
            </dl>
          </div>

          {/* Promo code — brand-editable at IO time (planning), else read-only. */}
          {canEditPromo ? (
            <div className={`p-5 ${panelClass}`} style={radiusStyle}>
              <h2 className={sectionHead}>
                Promo code
              </h2>
              <input
                value={promoCode}
                onChange={(e) => {
                  setPromoCode(e.target.value);
                  setPromoSaved(false);
                }}
                placeholder="e.g. HUBERMAN"
                className={`${fieldClass} font-mono uppercase tracking-wide`}
                style={radiusStyle}
              />
              <p className={`mt-2 text-xs ${mutedText}`}>
                Optional — the show reads this on air for attribution. Prefilled
                from the show name; edit or clear it.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={savePromoCode}
                  disabled={savingPromo}
                  className={ghostBtnClass}
                  style={radiusStyle}
                >
                  {savingPromo ? "Saving…" : "Save promo code"}
                </button>
                {promoSaved && (
                  <span className={`text-xs font-medium ${mutedText}`}>
                    Saved ✓
                  </span>
                )}
              </div>
            </div>
          ) : (
            deal.promo_code && (
              <div className={`p-5 ${panelClass}`} style={radiusStyle}>
                <h2 className={sectionHead}>
                  Promo code
                </h2>
                <p className={`font-mono text-sm tracking-wide ${inkText}`}>
                  {deal.promo_code}
                </p>
              </div>
            )
          )}

          {/* Tracking link — generated on read, read-only for both roles.
              Omitted cleanly when the brand has no website on file. */}
          {trackingLink && (
            <div className={`p-5 ${panelClass}`} style={radiusStyle}>
              <h2 className={sectionHead}>
                Tracking link
              </h2>
              <p className={`break-all border px-3 py-2 font-mono text-xs ${hairlineRule} bg-[var(--ts-band-shows)] ${inkText}`} style={radiusStyle}>
                {trackingLink}
              </p>
              <p className={`mt-2 text-xs ${mutedText}`}>
                UTM-tagged link for the show’s show notes — traffic attributes
                back to this deal in the brand’s analytics.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={copyTrackingLink}
                  className={ghostBtnClass}
                  style={radiusStyle}
                >
                  Copy link
                </button>
                {linkCopied && (
                  <span className={`text-xs font-medium ${mutedText}`}>
                    Copied ✓
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Show notes — copy-paste blurb (brand + saved promo code + tracking
              link), generated on read, read-only for both roles. The show is
              who pastes it. Omitted cleanly when there's nothing actionable. */}
          {showNotesBlurb && (
            <div className={`p-5 ${panelClass}`} style={radiusStyle}>
              <h2 className={sectionHead}>
                Show notes
              </h2>
              <p className={`border px-3 py-2 text-sm ${hairlineRule} bg-[var(--ts-band-shows)] ${inkText}`} style={radiusStyle}>
                {showNotesBlurb}
              </p>
              <p className={`mt-2 text-xs ${mutedText}`}>
                Ready-to-paste sponsor line for the episode description.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={copyBlurb}
                  className={ghostBtnClass}
                  style={radiusStyle}
                >
                  Copy blurb
                </button>
                {blurbCopied && (
                  <span className={`text-xs font-medium ${mutedText}`}>
                    Copied ✓
                  </span>
                )}
              </div>
            </div>
          )}

          <div className={`p-5 ${panelClass}`} style={radiusStyle}>
            <h2 className={sectionHead}>
              Signature status
            </h2>
            <dl className="grid grid-cols-1 gap-y-2 text-sm">
              <Term label="Brand signed" value={fmt(deal.brand_signed_at)} />
              <Term label="Show signed" value={fmt(deal.show_signed_at)} />
              {deal.cancelled_at && (
                <Term
                  label="Cancelled"
                  value={`${fmt(deal.cancelled_at)} — ${deal.cancellation_reason ?? "no reason"}`}
                />
              )}
            </dl>
            {deal.signed_io_pdf_url && (
              <div className="mt-3 text-xs">
                <span className={`font-medium ${inkText}`}>Signed PDF stored ✓</span>
              </div>
            )}
            {canShowSign && (
              <button
                onClick={sendToDocuSign}
                disabled={signing}
                className={`mt-4 ${inkBtnClass}`}
                style={radiusStyle}
              >
                {signing ? "Opening DocuSign…" : "Sign IO"}
              </button>
            )}
          </div>

          {(needsPaymentMethod || hasPaymentMethod) && (
            <div className={`p-5 ${panelClass}`} style={radiusStyle}>
              <h2 className={sectionHead}>
                Payment method
              </h2>
              {hasPaymentMethod ? (
                <p className={`text-sm font-medium ${inkText}`}>
                  Card on file saved
                </p>
              ) : (
                <>
                  {activeCardSecret ? (
                    <p className={`text-sm ${mutedText}`}>
                      Add the card Taylslate should charge as each episode is verified.
                    </p>
                  ) : (
                    <p className={`text-sm ${mutedText}`}>
                      Card setup will appear after DocuSign confirms your signature. You
                      can also add it now.
                    </p>
                  )}
                  {activeCardSecret && stripeInstance ? (
                    <Elements
                      stripe={stripeInstance}
                      options={{ clientSecret: activeCardSecret }}
                    >
                      <DealCardSetupForm
                        clientSecret={activeCardSecret}
                        onSaved={handleCardSaved}
                      />
                    </Elements>
                  ) : (
                    <button
                      onClick={loadPaymentForm}
                      disabled={loadingStripe}
                      className={`mt-3 ${inkBtnClass}`}
                      style={radiusStyle}
                    >
                      {loadingStripe ? "Loading Stripe..." : "Add card on file"}
                    </button>
                  )}
                  {cardSaved && (
                    <p className={`mt-2 text-xs font-medium ${mutedText}`}>
                      Card saved. Stripe will confirm it on this deal shortly.
                    </p>
                  )}
                  {cardError && (
                    <p className={`mt-2 text-sm ${accentText}`}>{cardError}</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Actions */}
          {(canSign || isCancellable) && (
            <div className={`space-y-3 p-5 ${panelClass}`} style={radiusStyle}>
              {canSign && (
                <button
                  onClick={sendToDocuSign}
                  disabled={signing || cancelling}
                  className={inkBtnClass}
                  style={radiusStyle}
                >
                  {signing ? "Opening DocuSign…" : "Sign IO"}
                </button>
              )}
              {isCancellable && !showCancelForm && (
                <button
                  onClick={() => setShowCancelForm(true)}
                  disabled={signing || cancelling}
                  className={`w-full ${ghostBtnClass}`}
                  style={radiusStyle}
                >
                  Cancel deal
                </button>
              )}
              {isCancellable && showCancelForm && (
                <div className="space-y-2">
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Reason (optional)"
                    rows={3}
                    className={fieldClass}
                    style={radiusStyle}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowCancelForm(false)}
                      disabled={cancelling}
                      className={`px-3 py-1.5 text-sm ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}
                    >
                      Back
                    </button>
                    <button
                      onClick={cancelDeal}
                      disabled={cancelling}
                      className={`${ghostBtnClass} ${accentText}`}
                      style={radiusStyle}
                    >
                      {cancelling ? "Cancelling…" : "Confirm cancel"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {grossPerEp != null && (
            <div className={`p-5 text-sm ${panelClass}`} style={radiusStyle}>
              ${grossPerEp}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className={mutedText}>{label}</dt>
      <dd className={`font-medium tabular-nums ${inkText}`}>{value}</dd>
    </>
  );
}
