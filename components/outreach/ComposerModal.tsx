"use client";

// Brand-facing pitch composer.
// Opens with Claude-drafted body + media-plan defaults; brand can edit and send.

import { useEffect, useState } from "react";
import type { OutreachPlacement } from "@/lib/data/types";
import { tokens } from "@/lib/brand/tokens";

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

const radiusStyle = { borderRadius: tokens.radius };

const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const hairlineRule = "border-[var(--ts-hairline-on-paper)]";
const panelClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
const inkBtnClass =
  "inline-flex items-center justify-center bg-[var(--ts-ink-on-paper)] px-5 py-2 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const ghostBtnClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:opacity-50";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ts-field)]/45 p-4">
      <div
        className={`max-h-[90vh] w-full max-w-2xl overflow-y-auto border bg-[var(--ts-paper)] ${hairlineRule}`}
        style={radiusStyle}
      >
        <div className={`sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--ts-paper)] px-6 py-4 ${hairlineRule}`}>
          <div>
            <h2 className={`text-lg font-semibold ${inkText}`}>
              Reach out to {show.show_name}
            </h2>
            <p className={`mt-0.5 text-xs ${mutedText}`}>
              They&apos;ll see your pitch and proposed terms; they can accept, counter, or decline.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className={`p-1 ${mutedText} hover:text-[var(--ts-ink-on-paper)] disabled:opacity-50`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 p-6">
          {/* Show summary */}
          <div className={`${panelClass} grid grid-cols-3 gap-3 p-4 text-sm`} style={radiusStyle}>
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
              className={fieldClass}
              style={radiusStyle}
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
                className={fieldClass}
                style={radiusStyle}
              />
            </Field>
            <Field label="Episodes">
              <input
                type="number"
                min={1}
                step={1}
                value={episodes}
                onChange={(e) => setEpisodes(Number(e.target.value))}
                className={fieldClass}
                style={radiusStyle}
              />
            </Field>
            <Field label="Placement">
              <select
                value={placement}
                onChange={(e) => setPlacement(e.target.value as OutreachPlacement)}
                className={fieldClass}
                style={radiusStyle}
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
                  className={fieldClass}
                  style={radiusStyle}
                />
                <span className={`text-xs ${mutedText}`}>to</span>
                <input
                  type="date"
                  value={flightEnd}
                  onChange={(e) => setFlightEnd(e.target.value)}
                  className={fieldClass}
                  style={radiusStyle}
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
              placeholder={drafting ? "Drafting your pitch…" : "Write your pitch…"}
              className={`${fieldClass} py-2.5 leading-relaxed`}
              style={radiusStyle}
            />
            <p className={`mt-1.5 text-[11px] ${mutedText}`}>
              The proposed terms above appear separately as a structured block — you don&apos;t need to repeat them in the body.
            </p>
          </Field>

          {error && (
            <div
              className={`border p-3 text-sm ${hairlineRule} bg-[var(--ts-band-brands)] ${inkText}`}
              style={radiusStyle}
            >
              {error}
            </div>
          )}
        </div>

        <div className={`sticky bottom-0 flex items-center justify-end gap-2 border-t bg-[var(--ts-paper)] px-6 py-4 ${hairlineRule}`}>
          <button
            onClick={onClose}
            disabled={sending}
            className={ghostBtnClass}
            style={radiusStyle}
          >
            Cancel
          </button>
          <button
            onClick={send}
            disabled={!canSend || sending || drafting}
            className={inkBtnClass}
            style={radiusStyle}
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
      <div className={`text-xs uppercase tracking-wider ${mutedText}`}>{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${inkText}`}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={`mb-1.5 block text-xs font-medium uppercase tracking-wider ${mutedText}`}>
        {label}
      </label>
      {children}
    </div>
  );
}
