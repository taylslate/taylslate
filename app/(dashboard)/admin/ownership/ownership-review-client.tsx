"use client";

import { useState } from "react";
import Link from "next/link";
import { tokens } from "@/lib/brand/tokens";
import type { OwnershipDetail, OwnershipQueueFilter, OwnershipQueueRow } from "@/lib/ownership/review";

const radiusStyle = { borderRadius: tokens.radius };
const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 bg-[var(--ts-accent)] px-4 py-2 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)] disabled:cursor-not-allowed disabled:opacity-50";
const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)] disabled:cursor-not-allowed disabled:opacity-50";
const cardClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3";
const mutedClass = "text-sm text-[var(--ts-ink-muted-on-paper)]";
const kickerClass = "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
const labelClass = "mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]";

const EMPTY = "No proofs need review.";
const REP_REVIEW = "Review the rep link in roster requests.";
const APPROVE_FALLBACK = "Couldn't approve that proof.";
const REJECT_FALLBACK = "Couldn't reject that proof.";
const LOAD_FALLBACK = "Couldn't load ownership reviews.";

const KNOWN_ERRORS = new Set([
  "Already decided",
  "This show already has a verified owner.",
  APPROVE_FALLBACK,
  REJECT_FALLBACK,
  "A reason of 1 to 500 characters is required.",
  "Not found",
  "Bad request.",
  "Ownership review needs migration 091.",
  "Too many requests. Try again later.",
  "unavailable",
  "Forbidden",
  "Unauthorized",
  "Request body is too large.",
  "Request body must be JSON.",
  "Invalid JSON",
  "Action must be approve or reject.",
  LOAD_FALLBACK,
  "Choose contested or expired.",
]);

function knownError(value: unknown, fallback: string): string {
  return typeof value === "string" && KNOWN_ERRORS.has(value) ? value : fallback;
}

function methodLabel(method: string | null): string {
  if (method === "rss_code") return "RSS code";
  if (method === "youtube_code") return "YouTube code";
  if (method === "admin") return "Admin";
  return "Unknown";
}

function statusLabel(status: string): string {
  if (status === "contested") return "In review";
  if (status === "expired") return "Expired";
  if (status === "pending") return "Pending";
  if (status === "verified") return "Verified";
  if (status === "rejected") return "Not verified";
  return "Unknown";
}

function formatWhen(value: string | null, empty: string): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function reasonCount(value: string): number {
  return Array.from(value.trim()).length;
}

export function OwnershipReviewClient({
  proofs,
  filter,
  error,
  initialDetail = null,
  initialNotice = null,
}: {
  proofs: OwnershipQueueRow[];
  filter: OwnershipQueueFilter | null;
  error: string | null;
  initialDetail?: OwnershipDetail | null;
  initialNotice?: string | null;
}) {
  const [rows, setRows] = useState(proofs);
  const [detail, setDetail] = useState<OwnershipDetail | null>(initialDetail);
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [line, setLine] = useState<string | null>(error);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = reason.trim();
  const count = reasonCount(reason);
  const reasonReady = count >= 1 && count <= 500;

  async function openDetail(row: OwnershipQueueRow) {
    setBusy(true);
    setLine(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/ownership/${row.id}`);
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown; proof?: OwnershipDetail["proof"]; other_proofs?: OwnershipDetail["other_proofs"]; rep_links?: OwnershipDetail["rep_links"] }
        | null;
      if (!response.ok || !payload?.proof) {
        setDetail(null);
        setLine(knownError(payload?.error, LOAD_FALLBACK));
        return;
      }
      setDetail({
        proof: payload.proof,
        other_proofs: payload.other_proofs ?? [],
        rep_links: payload.rep_links ?? [],
      });
      setReason("");
    } catch {
      setLine(LOAD_FALLBACK);
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "approve" | "reject") {
    if (!detail) return;
    if (action === "reject" && !reasonReady) return;
    setBusy(true);
    setLine(null);
    const fallback = action === "approve" ? APPROVE_FALLBACK : REJECT_FALLBACK;
    try {
      const response = await fetch(`/api/admin/ownership/${detail.proof.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "approve" ? { action } : { action, reason: trimmed }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (!response.ok) {
        setLine(knownError(payload?.error, fallback));
        return;
      }
      const id = detail.proof.id;
      setRows((current) => current.filter((row) => row.id !== id));
      setDetail(null);
      setReason("");
      setNotice(action === "approve" ? "Verified." : "Not verified.");
    } catch {
      setLine(fallback);
    } finally {
      setBusy(false);
    }
  }

  const filters: Array<{ href: string; label: string; current: boolean }> = [
    { href: "/admin/ownership", label: "All", current: filter == null },
    { href: "/admin/ownership?status=contested", label: "In review", current: filter === "contested" },
    { href: "/admin/ownership?status=expired", label: "Expired", current: filter === "expired" },
  ];
  const exclusiveLink = detail?.rep_links.some((link) => link.is_exclusive) ?? false;

  return (
    <div className="px-4 py-8 text-[var(--ts-ink-on-paper)] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <p className={kickerClass}>Admin</p>
        <h1 className="mt-2 font-[family-name:var(--font-app-display)] text-2xl font-semibold tracking-tight">
          Ownership review
        </h1>
        <p className={`mt-2 ${mutedClass}`}>Proofs that need a person. Decisions are final.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {filters.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className={item.current ? primaryButtonClass : ghostButtonClass}
              style={radiusStyle}
            >
              {item.label}
            </Link>
          ))}
        </div>

        {notice && (
          <p className="mt-4 text-sm text-[var(--ts-ink-on-paper)]" role="status">
            {notice}
          </p>
        )}
        {line && (
          <p className="mt-4 text-sm text-[var(--ts-ink-on-paper)]" role="alert">
            {line}
          </p>
        )}

        {!line && rows.length === 0 && (
          <p className="mt-6 text-sm text-[var(--ts-ink-on-paper)]">{EMPTY}</p>
        )}

        {rows.length > 0 && (
          <ul className="mt-6 space-y-3">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={`${cardClass} w-full text-left hover:bg-[var(--ts-band-shows)]`}
                  style={radiusStyle}
                  onClick={() => void openDetail(row)}
                  disabled={busy}
                >
                  <span className="font-semibold text-[var(--ts-ink-on-paper)]">
                    {row.show_name || "Unnamed show"}
                  </span>
                  <span className={`mt-1 block ${mutedClass}`}>
                    {methodLabel(row.method)}, {statusLabel(row.status)}, {row.target || "No target"}
                  </span>
                  <span className={`mt-1 block ${mutedClass}`}>
                    {row.requester_email || "No login email"}, {row.miss_count} misses, checked{" "}
                    {formatWhen(row.last_checked_at, "not yet")}, asked {formatWhen(row.created_at, "date not set")}
                  </span>
                  <span className="mt-1 block text-sm text-[var(--ts-ink-on-paper)]">
                    {row.note || "No note"}
                  </span>
                  <span className={`mt-1 block ${mutedClass}`}>
                    {row.exclusive_rep ? `Exclusive rep: ${row.rep_label || "A Taylslate sales agent"}` : "No approved exclusive rep"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {detail && (
          <section className={`${cardClass} mt-6`} style={radiusStyle} aria-label="Proof detail">
            <h2 className="font-[family-name:var(--font-app-display)] text-xl font-semibold">
              {detail.proof.show_name || "Unnamed show"}
            </h2>
            <dl className="mt-3 space-y-1 text-sm">
              <div>Method: {methodLabel(detail.proof.method)}</div>
              <div>Status: {statusLabel(detail.proof.status)}</div>
              <div>Target: {detail.proof.target || "No target"}</div>
              <div>RSS: {detail.proof.rss_url || "No RSS URL"}</div>
              <div>YouTube: {detail.proof.youtube_channel_id || "No YouTube channel"}</div>
              <div>Ownership: {detail.proof.ownership_status || "Unknown"}</div>
              <div>Requester: {detail.proof.requester_email || "No login email"}</div>
              <div>Reason: {detail.proof.note || "No note"}</div>
              {detail.proof.decision_note && <div>Decision: {detail.proof.decision_note}</div>}
            </dl>
            {exclusiveLink && <p className="mt-3 text-sm text-[var(--ts-ink-on-paper)]">{REP_REVIEW}</p>}

            <h3 className="mt-4 text-sm font-semibold">Other proofs</h3>
            {detail.other_proofs.length === 0 ? (
              <p className={`mt-1 ${mutedClass}`}>No other proofs.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {detail.other_proofs.map((other, index) => (
                  <li key={`${other.created_at}-${index}`} className={mutedClass}>
                    {statusLabel(other.status)}, {methodLabel(other.method)}, {formatWhen(other.created_at, "date not set")}
                    {other.decided_at ? `, decided ${formatWhen(other.decided_at, "date not set")}` : ""}
                    {other.decided_by_email ? `, ${other.decided_by_email}` : ""}
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mt-4 text-sm font-semibold">Rep links</h3>
            {detail.rep_links.length === 0 ? (
              <p className={`mt-1 ${mutedClass}`}>No rep links.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {detail.rep_links.map((link, index) => (
                  <li key={`${link.rep_label}-${index}`} className={mutedClass}>
                    {link.rep_label}, {link.status || "Unknown"}, {link.is_exclusive ? "Exclusive" : "Not exclusive"}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                style={radiusStyle}
                onClick={() => void decide("approve")}
                disabled={busy}
              >
                Approve
              </button>
            </div>
            <label className={`${labelClass} mt-4`} htmlFor="ownership-reject-reason">
              Reason
            </label>
            <textarea
              id="ownership-reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              className={fieldClass}
              style={radiusStyle}
            />
            <button
              type="button"
              className={`${ghostButtonClass} mt-3`}
              style={radiusStyle}
              onClick={() => void decide("reject")}
              disabled={busy || !reasonReady}
            >
              Reject
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
