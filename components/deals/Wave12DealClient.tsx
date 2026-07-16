"use client";

// Wave 12 deal detail — IO preview iframe + sign / cancel actions.
// Server-rendered shell loads the deal; this client hosts interactivity.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Wave12Deal, Wave12DealStatus } from "@/lib/data/types";
import { derivePromoCode } from "@/lib/io/promo-code";
import { formatDateOnly } from "@/lib/format/date-only";

interface Props {
  deal: Wave12Deal;
  showName: string;
  brandName: string;
  /** "brand" | "show" — drives which actions render. */
  viewerRole: "brand" | "show";
  signingHint?: string | null;
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

const STATUS_COLOR: Record<Wave12DealStatus, string> = {
  planning: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
  brand_signed: "bg-[var(--brand-warning)]/10 text-[var(--brand-warning)]",
  show_signed: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
  live: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
  delivering: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
  completed: "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]",
  cancelled: "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]",
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

export default function Wave12DealClient({
  deal,
  showName,
  brandName,
  viewerRole,
  signingHint,
  trackingLink,
  showNotesBlurb,
}: Props) {
  const router = useRouter();
  const [signing, setSigning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [blurbCopied, setBlurbCopied] = useState(false);

  // Promo code — prefill is display-only (never persisted until Save). If the
  // deal has a saved code, show it; otherwise seed the show-name slug.
  const [promoCode, setPromoCode] = useState(
    deal.promo_code ?? derivePromoCode(showName) ?? ""
  );
  const [savingPromo, setSavingPromo] = useState(false);
  const [promoSaved, setPromoSaved] = useState(false);

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

  const grossPerEp =
    deal.agreed_cpm > 0 && deal.agreed_episode_count > 0
      ? // Without audience size on the deal directly, leave the totals to the IO PDF.
        null
      : null;

  const isCancellable =
    viewerRole === "brand" && (deal.status === "planning" || deal.status === "brand_signed");
  const canSign = viewerRole === "brand" && deal.status === "planning";
  // Brand can set the promo code at IO time (before signature). Otherwise the
  // stored code renders read-only — and only if one was actually saved.
  const canEditPromo = viewerRole === "brand" && deal.status === "planning";

  return (
    <div className="px-8 py-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-1">
        <Link
          href="/deals"
          className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
          {brandName} × {showName}
        </h1>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[deal.status]}`}>
          {STATUS_LABEL[deal.status]}
        </span>
      </div>
      <p className="text-sm text-[var(--brand-text-secondary)] mb-6 ml-7">
        Deal ID: {deal.id.slice(0, 8)}
        {deal.docusign_envelope_id ? ` · DocuSign Envelope: ${deal.docusign_envelope_id.slice(0, 8)}` : ""}
      </p>

      {signingHint && (
        <div className="mb-4 p-3 rounded-lg border border-[var(--brand-blue)]/30 bg-[var(--brand-blue)]/[0.06] text-sm text-[var(--brand-text)]">
          DocuSign signing event: <strong>{signingHint}</strong>. Webhook will update this page within a few seconds.
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded-lg border border-[var(--brand-error)]/30 bg-[var(--brand-error)]/[0.04] text-sm text-[var(--brand-error)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* IO preview */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--brand-border)] flex items-center justify-between">
              <div className="text-sm font-semibold text-[var(--brand-text)]">Insertion Order preview</div>
              <a
                href={`/api/deals/${deal.id}/preview`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--brand-blue)] hover:underline"
              >
                Open in new tab
              </a>
            </div>
            <iframe
              src={`/api/deals/${deal.id}/preview`}
              title="IO preview"
              className="w-full h-[700px] bg-white"
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5">
            <h2 className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-semibold mb-3">
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
            <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5">
              <h2 className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-semibold mb-3">
                Promo code
              </h2>
              <input
                value={promoCode}
                onChange={(e) => {
                  setPromoCode(e.target.value);
                  setPromoSaved(false);
                }}
                placeholder="e.g. HUBERMAN"
                className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm font-mono uppercase tracking-wide text-[var(--brand-text)]"
              />
              <p className="mt-2 text-xs text-[var(--brand-text-muted)]">
                Optional — the show reads this on air for attribution. Prefilled
                from the show name; edit or clear it.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={savePromoCode}
                  disabled={savingPromo}
                  className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text)] hover:bg-[var(--brand-surface)] disabled:opacity-50"
                >
                  {savingPromo ? "Saving…" : "Save promo code"}
                </button>
                {promoSaved && (
                  <span className="text-xs text-[var(--brand-success)] font-medium">
                    Saved ✓
                  </span>
                )}
              </div>
            </div>
          ) : (
            deal.promo_code && (
              <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5">
                <h2 className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-semibold mb-3">
                  Promo code
                </h2>
                <p className="text-sm font-mono tracking-wide text-[var(--brand-text)]">
                  {deal.promo_code}
                </p>
              </div>
            )
          )}

          {/* Tracking link — generated on read, read-only for both roles.
              Omitted cleanly when the brand has no website on file. */}
          {trackingLink && (
            <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5">
              <h2 className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-semibold mb-3">
                Tracking link
              </h2>
              <p className="text-xs break-all font-mono text-[var(--brand-text)] bg-[var(--brand-surface)] border border-[var(--brand-border)] rounded-lg px-3 py-2">
                {trackingLink}
              </p>
              <p className="mt-2 text-xs text-[var(--brand-text-muted)]">
                UTM-tagged link for the show’s show notes — traffic attributes
                back to this deal in the brand’s analytics.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={copyTrackingLink}
                  className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text)] hover:bg-[var(--brand-surface)]"
                >
                  Copy link
                </button>
                {linkCopied && (
                  <span className="text-xs text-[var(--brand-success)] font-medium">
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
            <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5">
              <h2 className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-semibold mb-3">
                Show notes
              </h2>
              <p className="text-sm text-[var(--brand-text)] bg-[var(--brand-surface)] border border-[var(--brand-border)] rounded-lg px-3 py-2">
                {showNotesBlurb}
              </p>
              <p className="mt-2 text-xs text-[var(--brand-text-muted)]">
                Ready-to-paste sponsor line for the episode description.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={copyBlurb}
                  className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text)] hover:bg-[var(--brand-surface)]"
                >
                  Copy blurb
                </button>
                {blurbCopied && (
                  <span className="text-xs text-[var(--brand-success)] font-medium">
                    Copied ✓
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5">
            <h2 className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-semibold mb-3">
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
                <span className="text-[var(--brand-success)] font-medium">Signed PDF stored ✓</span>
              </div>
            )}
          </div>

          {/* Actions */}
          {(canSign || isCancellable) && (
            <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5 space-y-3">
              {canSign && (
                <button
                  onClick={sendToDocuSign}
                  disabled={signing || cancelling}
                  className="w-full px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-semibold disabled:opacity-50"
                >
                  {signing ? "Opening DocuSign…" : "Sign IO"}
                </button>
              )}
              {isCancellable && !showCancelForm && (
                <button
                  onClick={() => setShowCancelForm(true)}
                  disabled={signing || cancelling}
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:text-[var(--brand-error)]"
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
                    className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setShowCancelForm(false)}
                      disabled={cancelling}
                      className="px-3 py-1.5 text-sm text-[var(--brand-text-secondary)]"
                    >
                      Back
                    </button>
                    <button
                      onClick={cancelDeal}
                      disabled={cancelling}
                      className="px-4 py-1.5 rounded-lg bg-[var(--brand-error)] text-white text-sm font-medium disabled:opacity-50"
                    >
                      {cancelling ? "Cancelling…" : "Confirm cancel"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {grossPerEp != null && (
            <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5 text-sm">
              ${grossPerEp}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--brand-text-muted)]">{label}</dt>
      <dd className="text-[var(--brand-text)] font-medium tabular-nums">{value}</dd>
    </>
  );
}
