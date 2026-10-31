"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { tokens } from "@/lib/brand/tokens";
import type { PendingRosterRequest } from "@/lib/reps/roster-review";

const radiusStyle = { borderRadius: tokens.radius };
const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 bg-[var(--ts-accent)] px-4 py-2 text-sm font-medium text-[var(--ts-accent-foreground)] transition-opacity duration-300 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)] disabled:cursor-not-allowed disabled:opacity-50";
const ghostButtonClass =
  "inline-flex items-center justify-center gap-2 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] transition-opacity duration-300 hover:bg-[var(--ts-band-shows)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)] disabled:cursor-not-allowed disabled:opacity-50";
const cardClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3";
const mutedClass = "text-sm text-[var(--ts-ink-muted-on-paper)]";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
const labelClass = "mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]";

type DialogState =
  | { kind: "approve"; id: string }
  | { kind: "reject"; id: string }
  | null;

function sourceLabel(source: string | null): string {
  if (source === "admin") return "Admin";
  if (source === "import") return "Import";
  if (source === "claim") return "Claim";
  return source && source.trim() ? source : "Unknown source";
}

function agentLabel(email: string | null): string {
  return email && email.trim() ? email : "No email on file";
}

function formatDay(value: string): string {
  if (!value) return "Date not set";
  const iso = value.length === 10 ? `${value}T00:00:00Z` : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function exclusiveHolders(row: PendingRosterRequest): string {
  const holders = [
    ...new Set(
      row.otherLinks
        .filter((link) => link.status === "approved" && link.isExclusive)
        .map((link) => agentLabel(link.agentEmail))
    ),
  ];
  return holders.length > 0 ? holders.join(", ") : "another agent";
}

function StatusPill({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center bg-[var(--ts-band-shows)] px-2 py-0.5 text-xs font-medium text-[var(--ts-ink-on-paper)]"
      style={radiusStyle}
    >
      {children}
    </span>
  );
}

function ExclusiveMark({ on }: { on: boolean }) {
  const className = on
    ? "inline-flex items-center bg-[var(--ts-band-brands)] px-2.5 py-1 text-xs font-medium text-[var(--ts-ink-on-paper)]"
    : "inline-flex items-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-2.5 py-1 text-xs font-medium text-[var(--ts-ink-muted-on-paper)]";
  return (
    <span className={className} style={radiusStyle}>
      {on ? "Exclusive" : "Not exclusive"}
    </span>
  );
}

function Spinner({ ink = false }: { ink?: boolean }) {
  const tone = ink
    ? "border-[var(--ts-ink-on-paper)]/30 border-t-[var(--ts-ink-on-paper)]"
    : "border-[var(--ts-accent-foreground)]/30 border-t-[var(--ts-accent-foreground)]";
  return <span className={`h-3.5 w-3.5 animate-spin rounded-full border-2 ${tone}`} aria-hidden="true" />;
}

export function RosterRequestsClient({ links }: { links: PendingRosterRequest[] }) {
  const titleId = useId();
  const noteId = useId();
  const [rows, setRows] = useState(links);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const busy = busyId !== null;
  const active = dialog ? rows.find((row) => row.id === dialog.id) ?? null : null;
  const trimmedNote = note.trim();
  const noteCount = Array.from(trimmedNote).length;
  const noteReady = noteCount >= 1 && noteCount <= 500;

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setNote("");
  }

  async function post(
    row: PendingRosterRequest,
    body: { action: "approve" } | { action: "reject"; note: string }
  ) {
    setBusyId(row.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/roster-links/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (!response.ok) {
        const fallback =
          body.action === "approve" ? "Couldn't approve that link." : "Couldn't reject that link.";
        setError(payload && typeof payload.error === "string" ? payload.error : fallback);
        return;
      }
      setRows((current) => current.filter((item) => item.id !== row.id));
      setDialog(null);
      setNote("");
      setNotice(
        body.action === "approve" ? `Approved ${row.showName}.` : `Rejected ${row.showName}.`
      );
    } catch {
      setError(
        body.action === "approve" ? "Couldn't approve that link." : "Couldn't reject that link."
      );
    } finally {
      setBusyId(null);
    }
  }

  function approve(row: PendingRosterRequest) {
    setError(null);
    if (row.exclusiveConflict) {
      setDialog({ kind: "approve", id: row.id });
      return;
    }
    void post(row, { action: "approve" });
  }

  function reject(row: PendingRosterRequest) {
    if (!noteReady) return;
    void post(row, { action: "reject", note: trimmedNote });
  }

  return (
    <div className="px-4 py-8 text-[var(--ts-ink-on-paper)] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <p className={kickerClass}>Roster requests</p>
        <h1 className="mt-2 font-[family-name:var(--font-app-display)] text-2xl font-semibold tracking-tight">
          Roster requests
        </h1>
        <p className={`mt-2 ${mutedClass}`} data-testid="roster-pending-count">
          {rows.length} pending
        </p>
        <p className={`mt-2 ${mutedClass}`}>
          An imported or claimed link waits here. Approve makes it a live roster link. Reject
          keeps the row. A reject needs a note and does not change the show.
        </p>

        {notice ? (
          <p className={`mt-4 ${mutedClass}`} role="status">
            {notice}
          </p>
        ) : null}

        {error && !dialog ? (
          <p className="mt-4 text-sm text-[var(--ts-accent-text)]" role="alert">
            {error}
          </p>
        ) : null}

        {rows.length === 0 ? (
          <p className={`mt-6 ${mutedClass}`} data-testid="roster-requests-empty">
            No pending roster requests.
          </p>
        ) : (
          <ul className="mt-6 space-y-3" aria-label="Pending roster requests">
            {rows.map((row) => (
              <li
                key={row.id}
                className={cardClass}
                style={radiusStyle}
                data-testid="roster-request"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{row.showName}</p>
                    <p className={mutedClass}>
                      {agentLabel(row.agentEmail)} · {sourceLabel(row.source)}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusPill>Pending</StatusPill>
                      {row.disputedByOwner ? (
                        <span data-testid="disputed-by-owner">
                          <StatusPill>Disputed by owner</StatusPill>
                        </span>
                      ) : null}
                      <ExclusiveMark on={row.isExclusive} />
                      <StatusPill>{row.discoverable ? "Discoverable" : "Not discoverable"}</StatusPill>
                    </p>
                    <p className={`mt-2 ${mutedClass}`}>Requested {formatDay(row.createdAt)}.</p>
                    <p className={`mt-2 ${mutedClass}`}>
                      {row.showAgentDiffers
                        ? "The show agent does not match this link. Approving does not make the show discoverable."
                        : "The show agent matches this link. Approving makes the show discoverable."}
                    </p>
                    {row.exclusiveConflict ? (
                      <p
                        className="mt-3 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)]"
                        style={radiusStyle}
                        data-testid="exclusive-conflict"
                      >
                        Exclusive conflict. An approved exclusive link is held by{" "}
                        {exclusiveHolders(row)}.
                      </p>
                    ) : null}
                    {row.otherLinks.length > 0 ? (
                      <ul className={`mt-2 ${mutedClass}`}>
                        {row.otherLinks.map((link) => (
                          <li key={link.id}>
                            {agentLabel(link.agentEmail)},{" "}
                            {link.status === "approved" ? "Approved" : "Pending"},{" "}
                            {link.isExclusive ? "Exclusive" : "Not exclusive"}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={`mt-2 ${mutedClass}`}>No other pending or approved links.</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={primaryButtonClass}
                      style={radiusStyle}
                      disabled={busy || dialog !== null}
                      onClick={() => approve(row)}
                    >
                      {busyId === row.id && !dialog ? <Spinner /> : null}
                      Approve {row.showName}
                    </button>
                    <button
                      type="button"
                      className={ghostButtonClass}
                      style={radiusStyle}
                      disabled={busy || dialog !== null}
                      onClick={() => {
                        setError(null);
                        setNote("");
                        setDialog({ kind: "reject", id: row.id });
                      }}
                    >
                      Reject {row.showName}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {active && dialog?.kind === "approve" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ts-ink-on-paper)]/40 px-4"
          onClick={closeDialog}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="approve-dialog"
            className={`${cardClass} w-full max-w-md`}
            style={radiusStyle}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeDialog();
            }}
          >
            <h2
              id={titleId}
              className="font-[family-name:var(--font-app-display)] text-xl font-semibold tracking-tight"
            >
              Approve with a conflict?
            </h2>
            <p className={`mt-2 ${mutedClass}`}>
              An approved exclusive link on {active.showName} is held by {exclusiveHolders(active)}.
              Approving does not change those other links.
            </p>
            {error ? (
              <p className="mt-3 text-sm text-[var(--ts-accent-text)]" role="alert">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                style={radiusStyle}
                disabled={busy}
                autoFocus
                onClick={() => void post(active, { action: "approve" })}
              >
                {busy ? <Spinner /> : null}
                Approve {active.showName} anyway
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                style={radiusStyle}
                disabled={busy}
                onClick={closeDialog}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {active && dialog?.kind === "reject" ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ts-ink-on-paper)]/40 px-4"
          onClick={closeDialog}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="reject-dialog"
            className={`${cardClass} w-full max-w-md`}
            style={radiusStyle}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeDialog();
            }}
          >
            <h2
              id={titleId}
              className="font-[family-name:var(--font-app-display)] text-xl font-semibold tracking-tight"
            >
              Reject {active.showName}
            </h2>
            <p className={`mt-2 ${mutedClass}`}>
              A note is required, from 1 to 500 characters. Rejecting keeps the row and does not
              change the show.
            </p>
            {error ? (
              <p className="mt-3 text-sm text-[var(--ts-accent-text)]" role="alert">
                {error}
              </p>
            ) : null}
            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                reject(active);
              }}
            >
              <label htmlFor={noteId} className={labelClass}>
                Note
              </label>
              <textarea
                id={noteId}
                className={fieldClass}
                style={radiusStyle}
                rows={4}
                value={note}
                autoFocus
                onChange={(event) => setNote(event.target.value)}
              />
              <p className={`mt-1 ${mutedClass}`}>
                {noteCount} / 500
                {noteCount > 500 ? ". Use 1 to 500 characters." : ""}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="submit"
                  className={primaryButtonClass}
                  style={radiusStyle}
                  disabled={busy || !noteReady}
                >
                  {busy ? <Spinner /> : null}
                  Reject {active.showName}
                </button>
                <button
                  type="button"
                  className={ghostButtonClass}
                  style={radiusStyle}
                  disabled={busy}
                  onClick={closeDialog}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
