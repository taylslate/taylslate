"use client";

import { useState } from "react";
import type { Outreach } from "@/lib/data/types";

interface PitchClientProps {
  token: string;
  outreach: Outreach;
  brand: { brand_name: string; brand_url: string | null };
  isOnboarded: boolean;
  showStandardCpm: number | null;
}

type Mode = "view" | "magic" | "counter" | "decline" | "done";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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
        <div className="text-xs text-[var(--brand-text-muted)] uppercase tracking-wider mb-1">
          Sponsorship pitch
        </div>
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
          {brand.brand_name} wants to work with {outreach.show_name}
        </h1>
        {brand.brand_url && (
          <a
            href={brand.brand_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--brand-blue)] hover:underline"
          >
            {brand.brand_url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
          </a>
        )}
      </div>

      {/* Pitch body */}
      <article className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-6 mb-5">
        {outreach.pitch_body
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p, i) => (
            <p
              key={i}
              className="text-sm text-[var(--brand-text)] leading-relaxed mb-3 last:mb-0 whitespace-pre-wrap"
            >
              {p}
            </p>
          ))}
      </article>

      {/* Proposed terms */}
      <section className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-6 mb-6">
        <h2 className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-semibold mb-4">
          Proposed terms
        </h2>
        <dl className="grid grid-cols-2 gap-y-3 text-sm">
          <Row label="CPM" value={`$${outreach.proposed_cpm.toFixed(2)}`} />
          <Row label="Episodes" value={String(outreach.proposed_episode_count)} />
          <Row label="Placement" value={placementLabel(outreach.proposed_placement)} />
          <Row
            label="Flight"
            value={`${fmtDate(outreach.proposed_flight_start)} – ${fmtDate(outreach.proposed_flight_end)}`}
          />
        </dl>
        {showStandardCpm != null && showStandardCpm > 0 && (
          <div className="mt-4 pt-4 border-t border-[var(--brand-border)] text-xs text-[var(--brand-text-secondary)]">
            Their offer: <strong>${outreach.proposed_cpm.toFixed(2)}</strong> · Your standard:{" "}
            <strong>${showStandardCpm.toFixed(2)}</strong>
          </div>
        )}
      </section>

      {/* Action area */}
      {error && (
        <div className="mb-4 p-3 rounded-lg border border-[var(--brand-error)]/30 bg-[var(--brand-error)]/[0.04] text-sm text-[var(--brand-error)]">
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
            className="px-5 py-2.5 rounded-xl bg-[var(--brand-success)] hover:bg-[var(--brand-success)]/90 text-white text-sm font-semibold disabled:opacity-50"
          >
            Accept offer
          </button>
          <button
            onClick={() => setMode("counter")}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-semibold disabled:opacity-50"
          >
            Counter terms
          </button>
          <button
            onClick={() => setMode("decline")}
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:text-[var(--brand-text)]"
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

      <footer className="mt-10 text-center text-xs text-[var(--brand-text-muted)]">
        Payments and contracting powered by Taylslate.
      </footer>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--brand-text-muted)]">{label}</dt>
      <dd className="text-[var(--brand-text)] font-medium tabular-nums">{value}</dd>
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
      <div className="rounded-2xl border border-[var(--brand-success)]/30 bg-[var(--brand-success)]/[0.05] p-5">
        <div className="text-sm font-semibold text-[var(--brand-text)]">Check your inbox</div>
        <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
          We just sent a sign-in link to <strong>{email}</strong>. Click it to set up
          your show profile (about three minutes), then come right back here to
          accept or counter the offer.
        </p>
      </div>
    );
  }

  if (mode === "view") {
    return (
      <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5">
        <div className="text-sm font-semibold text-[var(--brand-text)] mb-2">
          Interested? Set up your account to respond.
        </div>
        <p className="text-sm text-[var(--brand-text-secondary)] mb-4">
          You&apos;ll quickly walk through your show details, then return here to
          accept, counter, or decline.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourshow.com"
            className="flex-1 px-3 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30"
          />
          <button
            onClick={startMagic}
            disabled={submitting || !email}
            className="px-5 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Sending…" : "Set up my account"}
          </button>
        </div>
        <button
          onClick={decline}
          disabled={submitting}
          className="mt-3 text-xs text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] underline"
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
    <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5 space-y-3">
      <div>
        <label className="block text-xs font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">
          Your counter CPM ($)
        </label>
        <input
          type="number"
          min={0}
          step={0.5}
          value={counterCpm}
          onChange={(e) => setCounterCpm(Number(e.target.value))}
          className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)]"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">
          Note (optional)
        </label>
        <textarea
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Happy to do this, but my mid-roll rate is $X with a 4-spot minimum."
          className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)]"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} disabled={submitting} className="px-4 py-2 text-sm text-[var(--brand-text-secondary)] hover:text-[var(--brand-text)]">
          Cancel
        </button>
        <button
          onClick={() => onSubmit(counterCpm, message.trim() || undefined)}
          disabled={submitting || counterCpm <= 0}
          className="px-5 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-semibold disabled:opacity-50"
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
    <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5 space-y-3">
      <div>
        <label className="block text-xs font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">
          Reason (optional)
        </label>
        <textarea
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional — helps the brand understand."
          className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)]"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} disabled={submitting} className="px-4 py-2 text-sm text-[var(--brand-text-secondary)] hover:text-[var(--brand-text)]">
          Cancel
        </button>
        <button
          onClick={() => onSubmit(reason.trim() || undefined)}
          disabled={submitting}
          className="px-5 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:text-[var(--brand-text)]"
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
      <h1 className="text-2xl font-bold text-[var(--brand-text)] mb-3">{headline}</h1>
      <p className="text-sm text-[var(--brand-text-secondary)]">
        We&apos;ve let {brandName} know. They&apos;ll follow up with {showName} from
        here. You can close this tab.
      </p>
      <footer className="mt-10 text-xs text-[var(--brand-text-muted)]">
        Payments and contracting powered by Taylslate.
      </footer>
    </div>
  );
}
