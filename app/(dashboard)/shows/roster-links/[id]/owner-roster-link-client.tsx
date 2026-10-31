"use client";

import { useId, useState } from "react";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };
const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 bg-[var(--ts-accent)] px-4 py-2 text-sm font-medium text-[var(--ts-accent-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ts-accent)] disabled:cursor-not-allowed disabled:opacity-50";
const cardClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-4";
const mutedClass = "text-sm text-[var(--ts-ink-muted-on-paper)]";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
const labelClass = "mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]";

export interface OwnerRosterLinkClientProps {
  linkId: string;
  showName: string;
  repLabel: string;
  status: "pending" | "approved" | "rejected";
}

function noteLength(value: string): number {
  return Array.from(value).length;
}

export function OwnerRosterLinkClient({
  linkId,
  showName,
  repLabel,
  status,
}: OwnerRosterLinkClientProps) {
  const noteId = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const trimmed = note.trim();
  const count = noteLength(trimmed);
  const tooLong = count > 500;
  const declined = status === "rejected";

  async function submit() {
    if (busy || tooLong || declined) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/roster-links/${linkId}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed ? { note: trimmed } : {}),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        result?: unknown;
      } | null;
      if (!response.ok) {
        setError(
          payload && typeof payload.error === "string" ? payload.error : "Couldn't flag that link."
        );
        return;
      }
      if (payload?.result === "already declined") {
        setNotice("This link was already declined.");
        return;
      }
      if (payload?.result === "already flagged") {
        setNotice("You already flagged this.");
        return;
      }
      setNotice("Flagged. Taylslate will review it.");
      setNote("");
    } catch {
      setError("Couldn't flag that link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-8 text-[var(--ts-ink-on-paper)] sm:px-8">
      <div className="mx-auto max-w-xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
          Your show
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-app-display)] text-2xl font-semibold tracking-tight">
          {showName}
        </h1>
        <div className={`mt-4 ${cardClass}`} style={radiusStyle}>
          <p className="text-sm text-[var(--ts-ink-on-paper)]">
            {repLabel} listed this show on their roster.
          </p>
          <p className={`mt-2 ${mutedClass}`}>
            {declined
              ? "This link was already declined."
              : status === "approved"
                ? "This link is already approved. If this is not right, flag it. The rep does not see your note."
                : "Taylslate is reviewing this link. Nothing is live yet. If this is not right, flag it. The rep does not see your note."}
          </p>

          {notice ? (
            <p className={`mt-4 ${mutedClass}`} role="status">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="mt-4 text-sm text-[var(--ts-accent-text)]" role="alert">
              {error}
            </p>
          ) : null}

          {declined ? null : (
            <form
              className="mt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label htmlFor={noteId} className={labelClass}>
                Note, optional
              </label>
              <textarea
                id={noteId}
                className={fieldClass}
                style={radiusStyle}
                rows={4}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <p className={`mt-1 ${mutedClass}`}>
                {count} / 500
                {tooLong ? ". Use at most 500 characters." : ""}
              </p>
              <button
                type="submit"
                className={`mt-4 ${primaryButtonClass}`}
                style={radiusStyle}
                disabled={busy || tooLong}
              >
                Flag this to Taylslate
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
