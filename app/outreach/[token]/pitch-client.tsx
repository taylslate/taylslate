"use client";

import { useState } from "react";
import type { Outreach } from "@/lib/data/types";
import { formatDateOnly } from "@/lib/format/date-only";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const accentText = "text-[var(--ts-accent)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const inkBtnClass =
  "inline-flex items-center justify-center bg-[var(--ts-ink-on-paper)] px-5 py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "inline-flex items-center justify-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-5 py-2.5 text-sm font-medium text-[var(--ts-ink-on-paper)] disabled:cursor-not-allowed disabled:opacity-50";
const textBtnClass = `px-4 py-2 text-sm ${mutedText} hover:text-[var(--ts-ink-on-paper)] disabled:opacity-50`;
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";

interface PitchClientProps {
  token: string;
  outreach: Outreach;
  brand: { brand_name: string; brand_url: string | null };
  isOnboarded: boolean;
  showStandardCpm: number | null;
}

type Mode = "view" | "magic" | "counter" | "decline" | "done";

function placementLabel(p: string): string {
  return p === "pre-roll" ? "Pre-roll" : p === "mid-roll" ? "Mid-roll" : "Post-roll";
}

export default function PitchClient(props: PitchClientProps) {
  const { token, outreach, brand, isOnboarded, showStandardCpm } = props;
  const [mode, setMode] = useState<Mode>(
    outreach.response_status !== "pending" ? "done" : "view"
  );
  const [doneStatus, setDoneStatus] = useState<string>(outreach.response_status);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const callAction = async (
    path: string,
    body?: Record<string, unknown>
  ): Promise<boolean> => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/outreach/${token}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't submit response.");
        setSubmitting(false);
        return false;
      }
      setSubmitting(false);
      return true;
    } catch {
      setError("Network error — please try again.");
      setSubmitting(false);
      return false;
    }
  };

  const accept = async () => {
    const ok = await callAction("accept");
    if (ok) {
      setDoneStatus("accepted");
      setMode("done");
    }
  };

  // Already terminal — show "already responded" view.
  if (mode === "done") {
    return (
      <DonePanel
        brandName={brand.brand_name}
        showName={outreach.show_name}
        status={doneStatus}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-6">
        <div className={`mb-1 text-xs uppercase tracking-wider ${mutedText}`}>
          Sponsorship pitch
        </div>
        <h1 className={`text-2xl font-bold tracking-tight ${inkText}`}>
          {brand.brand_name} wants to work with {outreach.show_name}
        </h1>
        {brand.brand_url && (
          <a
            href={brand.brand_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-sm ${accentText} hover:underline`}
          >
            {brand.brand_url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          </a>
        )}
      </div>

      {/* Pitch body */}
      <article className={`mb-5 p-6 ${panelClass}`} style={radiusStyle}>
        {outreach.pitch_body
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p, i) => (
            <p
              key={i}
              className={`mb-3 text-sm leading-relaxed whitespace-pre-wrap last:mb-0 ${inkText}`}
            >
              {p}
            </p>
          ))}
      </article>

      {/* Proposed terms */}
      <section className={`mb-6 p-6 ${panelClass}`} style={radiusStyle}>
        <h2 className={`mb-4 text-xs font-semibold uppercase tracking-wider ${mutedText}`}>
          Proposed terms
        </h2>
        <dl className="grid grid-cols-2 gap-y-3 text-sm">
          <Row label="CPM" value={`$${outreach.proposed_cpm.toFixed(2)}`} />
          <Row label="Episodes" value={String(outreach.proposed_episode_count)} />
          <Row label="Placement" value={placementLabel(outreach.proposed_placement)} />
          <Row
            label="Flight"
            value={`${formatDateOnly(outreach.proposed_flight_start)} – ${formatDateOnly(outreach.proposed_flight_end)}`}
          />
        </dl>
        {showStandardCpm != null && showStandardCpm > 0 && (
          <div className={`mt-4 border-t border-[var(--ts-hairline-on-paper)] pt-4 text-xs ${mutedText}`}>
            Their offer: <strong>${outreach.proposed_cpm.toFixed(2)}</strong> · Your standard:{" "}
            <strong>${showStandardCpm.toFixed(2)}</strong>
          </div>
        )}
      </section>

      {/* Action area */}
      {error && (
        <div
          className={`mb-4 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-3 text-sm ${accentText}`}
          style={radiusStyle}
        >
          {error}
        </div>
      )}

      {!isOnboarded && (
        <UnonboardedActions
          token={token}
          defaultEmail={outreach.sent_to_email}
          submitting={submitting}
          setSubmitting={setSubmitting}
          setError={setError}
          mode={mode}
          setMode={setMode}
        />
      )}

      {isOnboarded && mode === "view" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={accept}
            disabled={submitting}
            className={inkBtnClass}
            style={radiusStyle}
          >
            Accept offer
          </button>
          <button
            onClick={() => setMode("counter")}
            disabled={submitting}
            className={inkBtnClass}
            style={radiusStyle}
          >
            Counter terms
          </button>
          <button
            onClick={() => setMode("decline")}
            disabled={submitting}
            className={ghostBtnClass}
            style={radiusStyle}
          >
            Decline
          </button>
        </div>
      )}

      {isOnboarded && mode === "counter" && (
        <CounterForm
          proposedCpm={outreach.proposed_cpm}
          submitting={submitting}
          onCancel={() => setMode("view")}
          onSubmit={async (cpm, message) => {
            const ok = await callAction("counter", { counter_cpm: cpm, counter_message: message });
            if (ok) {
              setDoneStatus("countered");
              setMode("done");
            }
          }}
        />
      )}

      {isOnboarded && mode === "decline" && (
        <DeclineForm
          submitting={submitting}
          onCancel={() => setMode("view")}
          onSubmit={async (reason) => {
            const ok = await callAction("decline", { decline_reason: reason });
            if (ok) {
              setDoneStatus("declined");
              setMode("done");
            }
          }}
        />
      )}

      <footer className={`mt-10 text-center text-xs ${mutedText}`}>
        Payments and contracting powered by Taylslate.
      </footer>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className={mutedText}>{label}</dt>
      <dd className={`font-medium tabular-nums ${inkText}`}>{value}</dd>
    </>
  );
}

interface UnonboardedActionsProps {
  token: string;
  defaultEmail: string;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  setError: (v: string | null) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
}

function UnonboardedActions({
  token,
  defaultEmail,
  submitting,
  setSubmitting,
  setError,
  mode,
  setMode,
}: UnonboardedActionsProps) {
  const [email, setEmail] = useState<string>(defaultEmail);
  const [magicSent, setMagicSent] = useState<boolean>(false);

  const startMagic = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/magic/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outreach_token: token, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't send the link.");
        setSubmitting(false);
        return;
      }
      setMagicSent(true);
      setSubmitting(false);
    } catch {
      setError("Network error — please try again.");
      setSubmitting(false);
    }
  };

  const decline = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/outreach/${token}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't submit response.");
        setSubmitting(false);
        return;
      }
      setMode("done");
    } catch {
      setError("Network error — please try again.");
      setSubmitting(false);
    }
  };

  if (magicSent) {
    return (
      <div className={`p-5 ${panelClass}`} style={radiusStyle}>
        <div className={`text-sm font-semibold ${inkText}`}>Check your inbox</div>
        <p className={`mt-1 text-sm ${mutedText}`}>
          We just sent a sign-in link to <strong>{email}</strong>. Click it to set up
          your show profile (about three minutes), then come right back here to
          accept or counter the offer.
        </p>
      </div>
    );
  }

  if (mode === "view") {
    return (
      <div className={`p-5 ${panelClass}`} style={radiusStyle}>
        <div className={`mb-2 text-sm font-semibold ${inkText}`}>
          Interested? Set up your account to respond.
        </div>
        <p className={`mb-4 text-sm ${mutedText}`}>
          You&apos;ll quickly walk through your show details, then return here to
          accept, counter, or decline.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourshow.com"
            className={`flex-1 px-3 py-2.5 ${fieldClass}`}
            style={radiusStyle}
          />
          <button
            onClick={startMagic}
            disabled={submitting || !email}
            className={inkBtnClass}
            style={radiusStyle}
          >
            {submitting ? "Sending…" : "Set up my account"}
          </button>
        </div>
        <button
          onClick={decline}
          disabled={submitting}
          className={`mt-3 text-xs underline ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}
        >
          Not interested, not now
        </button>
      </div>
    );
  }

  return null;
}

function CounterForm({
  proposedCpm,
  submitting,
  onCancel,
  onSubmit,
}: {
  proposedCpm: number;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (cpm: number, message: string | undefined) => void;
}) {
  const [counterCpm, setCounterCpm] = useState<number>(proposedCpm);
  const [message, setMessage] = useState<string>("");
  return (
    <div className={`space-y-3 p-5 ${panelClass}`} style={radiusStyle}>
      <div>
        <label className={`mb-1.5 block text-xs font-medium uppercase tracking-wider ${mutedText}`}>
          Your counter CPM ($)
        </label>
        <input
          type="number"
          min={0}
          step={0.5}
          value={counterCpm}
          onChange={(e) => setCounterCpm(Number(e.target.value))}
          className={fieldClass}
          style={radiusStyle}
        />
      </div>
      <div>
        <label className={`mb-1.5 block text-xs font-medium uppercase tracking-wider ${mutedText}`}>
          Note (optional)
        </label>
        <textarea
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Happy to do this, but my mid-roll rate is $X with a 4-spot minimum."
          className={fieldClass}
          style={radiusStyle}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} disabled={submitting} className={textBtnClass}>
          Cancel
        </button>
        <button
          onClick={() => onSubmit(counterCpm, message.trim() || undefined)}
          disabled={submitting || counterCpm <= 0}
          className={inkBtnClass}
          style={radiusStyle}
        >
          Send counter
        </button>
      </div>
    </div>
  );
}

function DeclineForm({
  submitting,
  onCancel,
  onSubmit,
}: {
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (reason: string | undefined) => void;
}) {
  const [reason, setReason] = useState<string>("");
  return (
    <div className={`space-y-3 p-5 ${panelClass}`} style={radiusStyle}>
      <div>
        <label className={`mb-1.5 block text-xs font-medium uppercase tracking-wider ${mutedText}`}>
          Reason (optional)
        </label>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional — helps the brand understand."
          className={fieldClass}
          style={radiusStyle}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} disabled={submitting} className={textBtnClass}>
          Cancel
        </button>
        <button
          onClick={() => onSubmit(reason.trim() || undefined)}
          disabled={submitting}
          className={ghostBtnClass}
          style={radiusStyle}
        >
          Send decline
        </button>
      </div>
    </div>
  );
}

function DonePanel({
  brandName,
  showName,
  status,
}: {
  brandName: string;
  showName: string;
  status: string;
}) {
  const headline =
    status === "accepted"
      ? `Nice — ${brandName} will reach out with next steps.`
      : status === "countered"
        ? `Counter sent. ${brandName} will let you know.`
        : status === "declined"
          ? "Thanks for letting them know."
          : "This opportunity has already been responded to.";
  return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center">
      <h1 className={`mb-3 text-2xl font-bold ${inkText}`}>{headline}</h1>
      <p className={`text-sm ${mutedText}`}>
        We&apos;ve let {brandName} know. They&apos;ll follow up with {showName} from
        here. You can close this tab.
      </p>
      <footer className={`mt-10 text-xs ${mutedText}`}>
        Payments and contracting powered by Taylslate.
      </footer>
    </div>
  );
}
