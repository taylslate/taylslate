"use client";

// Brand-facing pitch composer.
// Opens with Claude-drafted body + media-plan defaults; brand can edit and send.

import { useEffect, useState } from "react";
import type { OutreachPlacement } from "@/lib/data/types";

export interface ComposerShow {
  show_id?: string | null;
  podscan_id?: string | null;
  show_name: string;
  contact_email: string;
  audience_size?: number | null;
  estimated_cpm?: number | null;
  show_standard_cpm?: number | null;
  categories?: string[];
  existing_sponsors?: string[];
  default_episode_count?: number;
  default_placement?: OutreachPlacement;
  flight_start?: string;
  flight_end?: string;
}

interface Props {
  show: ComposerShow;
  campaignId: string;
  onClose: () => void;
  onSent: (outreachId: string) => void;
}

const PLACEMENTS: { value: OutreachPlacement; label: string }[] = [
  { value: "pre-roll", label: "Pre-roll" },
  { value: "mid-roll", label: "Mid-roll" },
  { value: "post-roll", label: "Post-roll" },
];

function fmtIsoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function defaultFlight(): { start: string; end: string } {
  const start = new Date();
  start.setDate(start.getDate() + 14);
  const end = new Date(start);
  end.setDate(end.getDate() + 28);
  return { start: fmtIsoDate(start), end: fmtIsoDate(end) };
}

export default function ComposerModal({ show, campaignId, onClose, onSent }: Props) {
  const initialFlight = defaultFlight();

  const [cpm, setCpm] = useState<number>(
    Number(show.estimated_cpm ?? show.show_standard_cpm ?? 25)
  );
  const [episodes, setEpisodes] = useState<number>(show.default_episode_count ?? 3);
  const [placement, setPlacement] = useState<OutreachPlacement>(
    show.default_placement ?? "mid-roll"
  );
  const [flightStart, setFlightStart] = useState<string>(
    show.flight_start ?? initialFlight.start
  );
  const [flightEnd, setFlightEnd] = useState<string>(
    show.flight_end ?? initialFlight.end
  );
  const [contactEmail, setContactEmail] = useState<string>(show.contact_email);

  const [pitchBody, setPitchBody] = useState<string>("");
  const [drafting, setDrafting] = useState<boolean>(true);
  const [sending, setSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Fire the draft request when the modal mounts. Re-running it on prop change
  // would clobber edits, so it only runs once per open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDrafting(true);
      try {
        const res = await fetch("/api/outreach/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            show: {
              show_name: show.show_name,
              categories: show.categories,
              audience_size: show.audience_size,
              existing_sponsors: show.existing_sponsors,
            },
            proposed: { cpm, episode_count: episodes, placement },
          }),
        });
        const data = await res.json();
        if (!cancelled) {
          if (res.ok && data.pitch_body) {
            setPitchBody(data.pitch_body);
          } else {
            setError(data.error ?? "Couldn't draft a pitch — write your own below.");
          }
        }
      } catch {
        if (!cancelled) {
          setError("Couldn't draft a pitch — write your own below.");
        }
      } finally {
        if (!cancelled) setDrafting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaignId,
          show: {
            show_id: show.show_id,
            podscan_id: show.podscan_id,
            show_name: show.show_name,
            contact_email: contactEmail,
            categories: show.categories,
            audience_size: show.audience_size,
          },
          proposed: {
            cpm,
            episode_count: episodes,
            placement,
            flight_start: flightStart,
            flight_end: flightEnd,
          },
          pitch_body: pitchBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't send outreach.");
        setSending(false);
        return;
      }
      onSent(data.outreach.id);
    } catch {
      setError("Network error — please try again.");
      setSending(false);
    }
  };

  const canSend =
    pitchBody.trim().length >= 30 &&
    cpm > 0 &&
    episodes > 0 &&
    Boolean(flightStart) &&
    Boolean(flightEnd) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--brand-surface-elevated)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-[var(--brand-border)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--brand-border)] sticky top-0 bg-[var(--brand-surface-elevated)] z-10">
          <div>
            <h2 className="text-lg font-bold text-[var(--brand-text)]">
              Reach out to {show.show_name}
            </h2>
            <p className="text-xs text-[var(--brand-text-muted)] mt-0.5">
              They&apos;ll see your pitch and proposed terms; they can accept, counter, or decline.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] p-1 disabled:opacity-50"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Show summary */}
          <div className="rounded-xl bg-[var(--brand-surface)] border border-[var(--brand-border)] p-4 grid grid-cols-3 gap-3 text-sm">
            <Stat label="Audience" value={show.audience_size ? `${(show.audience_size / 1000).toFixed(0)}K` : "—"} />
            <Stat
              label="Show standard CPM"
              value={show.show_standard_cpm ? `$${show.show_standard_cpm.toFixed(2)}` : "—"}
            />
            <Stat
              label="Est. spot price"
              value={
                show.audience_size && cpm
                  ? `$${Math.round((show.audience_size / 1000) * cpm).toLocaleString()}`
                  : "—"
              }
            />
          </div>

          {/* Recipient */}
          <Field label="Recipient email">
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30"
            />
          </Field>

          {/* Proposed terms */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Proposed CPM ($)">
              <input
                type="number"
                min={0}
                step={0.5}
                value={cpm}
                onChange={(e) => setCpm(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30"
              />
            </Field>
            <Field label="Episodes">
              <input
                type="number"
                min={1}
                step={1}
                value={episodes}
                onChange={(e) => setEpisodes(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30"
              />
            </Field>
            <Field label="Placement">
              <select
                value={placement}
                onChange={(e) => setPlacement(e.target.value as OutreachPlacement)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30"
              >
                {PLACEMENTS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Flight">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={flightStart}
                  onChange={(e) => setFlightStart(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30"
                />
                <span className="text-xs text-[var(--brand-text-muted)]">to</span>
                <input
                  type="date"
                  value={flightEnd}
                  onChange={(e) => setFlightEnd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30"
                />
              </div>
            </Field>
          </div>

          {/* Pitch body */}
          <Field label={drafting ? "Pitch body (drafting…)" : "Pitch body"}>
            <textarea
              value={pitchBody}
              onChange={(e) => setPitchBody(e.target.value)}
              disabled={drafting}
              rows={9}
              placeholder={drafting ? "Claude is writing your pitch…" : "Write your pitch…"}
              className="w-full px-3 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 leading-relaxed"
            />
            <p className="text-[11px] text-[var(--brand-text-muted)] mt-1.5">
              The proposed terms above appear separately as a structured block — you don&apos;t need to repeat them in the body.
            </p>
          </Field>

          {error && (
            <div className="p-3 rounded-lg border border-[var(--brand-error)]/30 bg-[var(--brand-error)]/[0.04] text-sm text-[var(--brand-error)]">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--brand-border)] sticky bottom-0 bg-[var(--brand-surface-elevated)]">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 text-sm text-[var(--brand-text-secondary)] hover:text-[var(--brand-text)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={!canSend || sending || drafting}
            className="px-5 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? "Sending…" : "Send outreach"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--brand-text-muted)] uppercase tracking-wider">{label}</div>
      <div className="text-sm font-semibold text-[var(--brand-text)] mt-0.5">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--brand-text-muted)] uppercase tracking-wider mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
