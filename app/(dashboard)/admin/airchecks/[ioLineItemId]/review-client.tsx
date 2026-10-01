"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { tokens } from "@/lib/brand/tokens";
import type { AircheckReviewView } from "@/lib/airchecks/types";

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const panelClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const inkBtnClass =
  "inline-flex items-center bg-[var(--ts-ink-on-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "inline-flex items-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none disabled:bg-[var(--ts-band-shows)]";

const MATCH_LABEL: Record<string, string> = {
  matched: "Matched",
  not_matched: "Not matched",
  skipped: "Skipped",
};

function fact(value: string | null): string {
  return value?.trim() ? value : "None";
}

function matchLabel(view: AircheckReviewView): string {
  if (!view.hasAircheck) return "No aircheck stored";
  if (!view.matchResult) return "Not judged";
  return MATCH_LABEL[view.matchResult] ?? view.matchResult;
}

function decidedWhen(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

interface Notice {
  tone: "ok" | "error";
  text: string;
}

export default function AircheckReviewClient({
  view,
}: {
  view: AircheckReviewView;
}) {
  const router = useRouter();
  const [reason, setReason] = useState(view.reviewReason ?? "");
  const [pending, setPending] = useState<"confirm" | "reject" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const confirmed = view.reviewDecision === "confirmed";
  const locked = confirmed || pending !== null;

  async function submit(decision: "confirm" | "reject") {
    setPending(decision);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/aircheck/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ioLineItemId: view.ioLineItemId,
          decision,
          reason: decision === "reject" ? reason : undefined,
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        alreadyCharged?: boolean;
        chargeError?: string;
        error?: string;
      };
      if (!res.ok || body.ok === false) {
        setNotice({
          tone: "error",
          text:
            body.chargeError ||
            body.error ||
            "The review could not be saved.",
        });
        return;
      }
      if (decision === "confirm") {
        setNotice({
          tone: "ok",
          text: body.alreadyCharged
            ? "This line was already charged. No second charge was created."
            : "Confirmed. The line is delivered and the charge succeeded.",
        });
      } else {
        setNotice({
          tone: "ok",
          text: "Rejected. Nothing was charged.",
        });
      }
    } catch {
      setNotice({
        tone: "error",
        text: "The review could not be saved.",
      });
    } finally {
      setPending(null);
      router.refresh();
    }
  }

  const durable =
    view.reviewDecision === "confirmed"
      ? "Confirmed. This line is delivered and charged."
      : view.reviewDecision === "rejected"
        ? `Rejected${view.decidedBy ? ` by ${view.decidedBy}` : ""}${
            decidedWhen(view.decidedAt) ? ` on ${decidedWhen(view.decidedAt)}` : ""
          }. Nothing was charged.`
        : view.chargeError
          ? `The charge failed, so this line is not confirmed. ${view.chargeError}`
          : null;

  return (
    <div className="min-w-0 max-w-2xl p-4 sm:p-8">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]">
        Aircheck
      </p>
      <h1 className={`mt-2 text-2xl font-semibold tracking-tight ${inkText}`}>
        {view.showName}
      </h1>
      <p className={`mb-8 mt-1 text-sm ${mutedText}`}>
        Review the match, then confirm or reject this insertion-order line.
      </p>

      <dl className={`grid min-w-0 gap-5 p-5 sm:grid-cols-2 ${panelClass}`} style={radiusStyle}>
        <Fact label="Show" value={view.showName} />
        <Fact label="Advertiser" value={fact(view.advertiserName)} />
        <Fact label="Brand" value={fact(view.brandName)} />
        <Fact label="Promo code" value={fact(view.promoCode)} />
        <Fact label="URL" value={fact(view.url)} />
        <Fact label="Placement" value={fact(view.placement)} />
        <div className="min-w-0 sm:col-span-2">
          <dt className={`text-xs uppercase tracking-[0.14em] ${mutedText}`}>Match</dt>
          <dd className={`mt-1 text-sm ${inkText}`}>{matchLabel(view)}</dd>
          {view.skipReason ? (
            <p className={`mt-1 text-sm ${mutedText}`}>{view.skipReason}</p>
          ) : null}
          {view.checks ? (
            <p className={`mt-2 text-sm ${mutedText}`}>
              Brand {view.checks.brand} · Code or URL {view.checks.codeOrUrl} · Position{" "}
              {view.checks.position} · Length {view.checks.length}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className={`text-xs uppercase tracking-[0.14em] ${mutedText}`}>Excerpt</dt>
          <dd
            className={`mt-2 whitespace-pre-wrap break-words border border-[var(--ts-hairline-on-paper)] p-3 text-sm ${inkText}`}
            style={radiusStyle}
          >
            {view.excerpt?.trim() ? view.excerpt : "No excerpt."}
          </dd>
        </div>
      </dl>

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mt-6 text-sm ${notice.tone === "error" ? "text-[var(--ts-accent)]" : inkText}`}
        >
          {notice.text}
        </p>
      ) : durable ? (
        <p
          role={view.chargeError && !confirmed ? "alert" : "status"}
          className={`mt-6 text-sm ${
            view.chargeError && !confirmed ? "text-[var(--ts-accent)]" : inkText
          }`}
        >
          {durable}
          {view.reviewDecision === "rejected" && view.reviewReason
            ? ` Reason: ${view.reviewReason}`
            : ""}
        </p>
      ) : null}

      {view.hasAircheck ? (
        <div className="mt-6">
          <label htmlFor="aircheck-reject-reason" className={`text-sm ${mutedText}`}>
            Rejection reason, if you are rejecting
          </label>
          <textarea
            id="aircheck-reject-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            disabled={locked}
            placeholder="Optional"
            className={`mt-2 ${fieldClass}`}
            style={radiusStyle}
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className={inkBtnClass}
              style={radiusStyle}
              disabled={locked}
              onClick={() => submit("confirm")}
            >
              {pending === "confirm" ? "Confirming…" : "Confirm"}
            </button>
            <button
              type="button"
              className={ghostBtnClass}
              style={radiusStyle}
              disabled={locked}
              onClick={() => submit("reject")}
            >
              {pending === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </div>
        </div>
      ) : (
        <p className={`mt-6 text-sm ${mutedText}`}>
          Run the aircheck before reviewing this line. Confirm and reject stay
          unavailable until a row is stored.
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-[0.14em] text-[var(--ts-ink-muted-on-paper)]">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-[var(--ts-ink-on-paper)]">{value}</dd>
    </div>
  );
}
