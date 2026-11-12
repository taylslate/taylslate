"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { tokens } from "@/lib/brand/tokens";

const PASTE =
  "Paste this code in your show description or in a recent episode's notes. Once we see it you can delete it.";
const REVIEW = "We passed this to our team to review.";
const MISS = "Not found yet. Feeds can take a while to update.";
const YOUTUBE_LATER = "We could not check YouTube right now. Try again later.";
const VERIFIED = "Verified";
const NO_FEED = "Add your RSS feed to your show profile first.";
const CHANNEL = "Paste your channel URL that starts with youtube.com/channel/.";
const NO_CATALOG = "We could not find this show in the catalog yet.";
const MEDIUM = "Choose podcast or YouTube.";
const NOTHING = "Nothing to check.";
const UNAVAILABLE = "unavailable";
const RATE = "Too many requests. Try again later.";
const YOUTUBE_UNAVAILABLE = "YouTube checks are not available yet.";
const REVIEWING = "Our team is reviewing this.";
const NOT_VERIFIED = "Not verified";
const MANUAL_ASK = "Ask for manual review";
const MANUAL_HELP = "Tell us how you control this show. A link is optional and must start with https.";
const EXPLAIN_ERROR = "Explain the request in 20 to 1000 characters.";
const LINK_ERROR = "The link must be an https URL of at most 300 characters.";
const DUPLICATE = "Your request is already with our team.";
const PAYOUT_WAITING = "You have a payout waiting. Verify you own your show to receive it.";

const KNOWN = new Set([
  PASTE,
  REVIEW,
  MISS,
  YOUTUBE_LATER,
  VERIFIED,
  NO_FEED,
  CHANNEL,
  NO_CATALOG,
  MEDIUM,
  NOTHING,
  UNAVAILABLE,
  RATE,
  "Forbidden",
  "Unauthorized",
  EXPLAIN_ERROR,
  LINK_ERROR,
  DUPLICATE,
]);

const CODE_RE = /^TAYLSLATE-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export interface OwnershipProofInput {
  method: string | null;
  status: string;
  target: string | null;
  code_expires_at: string | null;
  created_at: string;
  decision_note?: string | null;
  decided_at?: string | null;
}

export interface OwnershipView {
  kind: "not_started" | "pending" | "verified" | "review" | "expired" | "rejected";
  feedUrl: string | null;
  youtubeAvailable: boolean;
  target: string | null;
  medium: "podcast" | "youtube" | null;
  pendingLabel: string;
  verifiedLabel: string;
  loadError?: boolean;
  decisionNote?: string | null;
  manual?: boolean;
  payoutWaiting?: boolean;
}

function mediumOf(method: string | null): "podcast" | "youtube" | null {
  if (method === "rss_code") return "podcast";
  if (method === "youtube_code") return "youtube";
  return null;
}

export function ownershipView(input: {
  proofs: OwnershipProofInput[];
  feedUrl: string | null;
  youtubeAvailable: boolean;
  pendingLabel: string;
  verifiedLabel: string;
  now?: Date;
}): OwnershipView {
  const now = input.now ?? new Date();
  const feedUrl = input.feedUrl?.trim() ? input.feedUrl.trim() : null;
  const manual = !input.proofs.some((row) => row.status === "verified" || row.status === "contested");
  const base = {
    feedUrl,
    youtubeAvailable: input.youtubeAvailable,
    target: null as string | null,
    medium: null as "podcast" | "youtube" | null,
    pendingLabel: input.pendingLabel,
    verifiedLabel: input.verifiedLabel,
    manual,
  };
  const proofs = [...input.proofs]
    .filter((row) => row.target)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  if (proofs.length === 0) return { ...base, kind: "not_started" };
  const target = proofs[0].target;
  const group = proofs.filter((row) => row.target === target);
  const medium = mediumOf(group.find((row) => row.method)?.method ?? null);
  const livePending = group.some((row) => {
    if (row.status !== "pending") return false;
    if (!row.code_expires_at) return true;
    return new Date(row.code_expires_at).getTime() > now.getTime();
  });
  if (livePending) return { ...base, kind: "pending", target, medium };
  if (group.some((row) => row.status === "contested")) {
    return { ...base, kind: "review", target, medium };
  }
  if (group.some((row) => row.status === "verified")) {
    return { ...base, kind: "verified", target, medium };
  }
  const rejected = group.find((row) => row.status === "rejected");
  if (rejected) {
    const decisionNote = typeof rejected.decision_note === "string" ? rejected.decision_note : null;
    return { ...base, kind: "rejected", target, medium, decisionNote };
  }
  if (group.some((row) => row.status === "expired" || row.status === "pending")) {
    return { ...base, kind: "expired" };
  }
  return { ...base, kind: "not_started" };
}

const radiusStyle = { borderRadius: tokens.radius };

function payoutBanner(show: boolean) {
  if (!show) return null;
  return (
    <p
      className="mb-4 mt-4 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3 text-sm text-[var(--ts-ink-on-paper)]"
      role="status"
      style={radiusStyle}
    >
      {PAYOUT_WAITING}
    </p>
  );
}
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5";
const inkBtn =
  "inline-flex items-center bg-[var(--ts-accent)] px-4 py-2 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtn =
  "inline-flex items-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";

function knownText(value: unknown): string | null {
  return typeof value === "string" && KNOWN.has(value) ? value : null;
}

export default function OwnershipClient({ view }: { view: OwnershipView }) {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState("");
  const [manualMedium, setManualMedium] = useState<"podcast" | "youtube">("podcast");
  const [manualChannel, setManualChannel] = useState("");
  const [explanation, setExplanation] = useState("");
  const [link, setLink] = useState("");
  const again = view.kind === "expired" || view.kind === "rejected";
  const showManual = view.manual ?? (view.kind !== "verified" && view.kind !== "review");
  const explanationReady = Array.from(explanation.trim()).length >= 20 && Array.from(explanation.trim()).length <= 1000;

  async function readBody(res: Response): Promise<{ error: string | null; message: string | null; code: string | null }> {
    const body = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown; code?: unknown } | null;
    const error = knownText(body?.error);
    const nextMessage = knownText(body?.message);
    const nextCode = typeof body?.code === "string" && CODE_RE.test(body.code) ? body.code : null;
    if (!res.ok) return { error: error ?? UNAVAILABLE, message: null, code: null };
    return { error: null, message: nextMessage, code: nextCode };
  }

  async function start(medium: "podcast" | "youtube") {
    setBusy(true);
    setMessage(null);
    const payload = medium === "youtube" ? { medium, channel } : { medium };
    const res = await fetch("/api/ownership/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const parsed = await readBody(res);
    setBusy(false);
    if (parsed.error) {
      setMessage(parsed.error);
      return;
    }
    setCode(parsed.code);
    setMessage(parsed.code ? null : parsed.message);
    router.refresh();
  }

  async function askManual() {
    setBusy(true);
    setMessage(null);
    const payload: { medium: "podcast" | "youtube"; explanation: string; link?: string; channel?: string } = {
      medium: manualMedium,
      explanation: explanation.trim(),
    };
    const trimmedLink = link.trim();
    if (trimmedLink) payload.link = trimmedLink;
    if (manualMedium === "youtube") payload.channel = manualChannel;
    const res = await fetch("/api/ownership/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const parsed = await readBody(res);
    setBusy(false);
    if (parsed.error) {
      setMessage(parsed.error);
      return;
    }
    setMessage(parsed.message);
    router.refresh();
  }

  async function checkNow() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/ownership/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const parsed = await readBody(res);
    setBusy(false);
    if (parsed.error) {
      setMessage(parsed.error);
      return;
    }
    if (parsed.message === VERIFIED || parsed.message === REVIEW) setCode(null);
    setMessage(parsed.message);
    router.refresh();
  }

  const showCode = Boolean(code) && view.kind !== "verified" && view.kind !== "review";
  const showCheck = showCode || view.kind === "pending";
  const showPayout = Boolean(view.payoutWaiting) && view.kind !== "verified";

  if (view.loadError) {
    return (
      <div className="max-w-2xl p-4 sm:p-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
          For shows
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-app-display)] text-2xl font-semibold tracking-tight text-[var(--ts-ink-on-paper)]">
          Verify ownership
        </h1>
        {payoutBanner(showPayout)}
        <p className="mt-4 text-sm text-[var(--ts-ink-on-paper)]" role="alert">
          We could not load your ownership check. Refresh to try again.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl p-4 sm:p-8">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
        For shows
      </p>
      <h1 className="mt-2 font-[family-name:var(--font-app-display)] text-2xl font-semibold tracking-tight text-[var(--ts-ink-on-paper)]">
        Verify ownership
      </h1>
      <p className="mb-6 mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">
        Paste a short code into a description you control. Once we see it, you can delete the code.
      </p>

      {payoutBanner(showPayout)}

      {message && (
        <p className="mb-4 text-sm text-[var(--ts-ink-on-paper)]" role="status">
          {message}
        </p>
      )}

      {view.kind === "verified" && (
        <section className={panelClass} style={radiusStyle}>
          <p className="font-[family-name:var(--font-app-display)] text-xl font-semibold text-[var(--ts-ink-on-paper)]">
            {view.verifiedLabel}
          </p>
          {view.target && (
            <p className="mt-2 text-sm text-[var(--ts-ink-muted-on-paper)]">{view.target}</p>
          )}
          <p className="mt-2 text-sm text-[var(--ts-ink-on-paper)]">
            We saw the code. You can delete it from your description.
          </p>
        </section>
      )}

      {view.kind === "rejected" && !code && (
        <section className={`mb-6 ${panelClass}`} style={radiusStyle}>
          <p className="font-[family-name:var(--font-app-display)] text-xl font-semibold text-[var(--ts-ink-on-paper)]">
            {NOT_VERIFIED}
          </p>
          {view.decisionNote && (
            <p className="mt-2 text-sm text-[var(--ts-ink-on-paper)]">{view.decisionNote}</p>
          )}
          {view.target && (
            <p className="mt-2 text-sm text-[var(--ts-ink-muted-on-paper)]">{view.target}</p>
          )}
        </section>
      )}

      {view.kind === "review" && (
        <section className={panelClass} style={radiusStyle}>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
            {view.pendingLabel}
          </p>
          <p className="mt-2 text-sm text-[var(--ts-ink-on-paper)]">{REVIEWING}</p>
          {view.target && (
            <p className="mt-2 text-sm text-[var(--ts-ink-muted-on-paper)]">{view.target}</p>
          )}
        </section>
      )}

      {showCode && (
        <section className={`mb-6 ${panelClass}`} style={radiusStyle}>
          <p className="font-mono text-lg text-[var(--ts-ink-on-paper)]">{code}</p>
          <p className="mt-2 text-sm text-[var(--ts-ink-muted-on-paper)]">{PASTE}</p>
        </section>
      )}

      {showCheck && (
        <div className="mb-6">
          {view.kind === "pending" && view.target && !showCode && (
            <p className="mb-3 text-sm text-[var(--ts-ink-muted-on-paper)]">{view.target}</p>
          )}
          <button type="button" className={inkBtn} style={radiusStyle} onClick={checkNow} disabled={busy}>
            Check now
          </button>
        </div>
      )}

      {(view.kind === "not_started" || view.kind === "expired" || view.kind === "rejected") && !code && (
        <div className="space-y-4">
          {again && (
            <p className="text-sm text-[var(--ts-ink-on-paper)]">Start again.</p>
          )}
          <section className={panelClass} style={radiusStyle}>
            <h2 className="font-semibold text-[var(--ts-ink-on-paper)]">Podcast</h2>
            {view.feedUrl ? (
              <>
                <p className="mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">{view.feedUrl}</p>
                <button
                  type="button"
                  className={`${inkBtn} mt-4`}
                  style={radiusStyle}
                  onClick={() => start("podcast")}
                  disabled={busy}
                >
                  {again ? "Start again" : "Start"}
                </button>
              </>
            ) : (
              <p className="mt-1 text-sm text-[var(--ts-ink-on-paper)]">{NO_FEED}</p>
            )}
          </section>
          <section className={panelClass} style={radiusStyle}>
            <h2 className="font-semibold text-[var(--ts-ink-on-paper)]">YouTube</h2>
            {view.youtubeAvailable ? (
              <>
                <label className="mt-3 block text-sm font-medium text-[var(--ts-ink-on-paper)]" htmlFor="ownership-channel">
                  Channel URL
                </label>
                <input
                  id="ownership-channel"
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                  autoComplete="off"
                  maxLength={300}
                  placeholder="https://www.youtube.com/channel/UC"
                  className="mt-1.5 w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
                  style={radiusStyle}
                />
                <button
                  type="button"
                  className={`${ghostBtn} mt-4`}
                  style={radiusStyle}
                  onClick={() => start("youtube")}
                  disabled={busy}
                >
                  {again ? "Start again" : "Start"}
                </button>
              </>
            ) : (
              <p className="mt-1 text-sm text-[var(--ts-ink-on-paper)]">{YOUTUBE_UNAVAILABLE}</p>
            )}
          </section>
        </div>
      )}

      {showManual && (
        <section className={`mt-6 ${panelClass}`} style={radiusStyle}>
          <h2 className="font-semibold text-[var(--ts-ink-on-paper)]">{MANUAL_ASK}</h2>
          <p className="mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">{MANUAL_HELP}</p>
          <fieldset className="mt-3">
            <legend className="text-sm font-medium text-[var(--ts-ink-on-paper)]">Podcast or YouTube</legend>
            <label className="mt-2 flex items-center gap-2 text-sm text-[var(--ts-ink-on-paper)]">
              <input
                type="radio"
                name="ownership-manual-medium"
                checked={manualMedium === "podcast"}
                onChange={() => setManualMedium("podcast")}
              />
              Podcast
            </label>
            <label className="mt-1 flex items-center gap-2 text-sm text-[var(--ts-ink-on-paper)]">
              <input
                type="radio"
                name="ownership-manual-medium"
                checked={manualMedium === "youtube"}
                onChange={() => setManualMedium("youtube")}
              />
              YouTube
            </label>
          </fieldset>
          {manualMedium === "youtube" && (
            <>
              <label className="mt-3 block text-sm font-medium text-[var(--ts-ink-on-paper)]" htmlFor="ownership-manual-channel">
                Channel URL
              </label>
              <input
                id="ownership-manual-channel"
                value={manualChannel}
                onChange={(event) => setManualChannel(event.target.value)}
                autoComplete="off"
                maxLength={300}
                placeholder="https://www.youtube.com/channel/UC"
                className="mt-1.5 w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
                style={radiusStyle}
              />
            </>
          )}
          <label className="mt-3 block text-sm font-medium text-[var(--ts-ink-on-paper)]" htmlFor="ownership-manual-explanation">
            Explanation
          </label>
          <textarea
            id="ownership-manual-explanation"
            value={explanation}
            onChange={(event) => setExplanation(event.target.value)}
            rows={4}
            maxLength={1000}
            className="mt-1.5 w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
            style={radiusStyle}
          />
          <label className="mt-3 block text-sm font-medium text-[var(--ts-ink-on-paper)]" htmlFor="ownership-manual-link">
            Link
          </label>
          <input
            id="ownership-manual-link"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            autoComplete="off"
            maxLength={300}
            placeholder="https://"
            className="mt-1.5 w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
            style={radiusStyle}
          />
          <button
            type="button"
            className={`${ghostBtn} mt-4`}
            style={radiusStyle}
            onClick={askManual}
            disabled={busy || !explanationReady}
          >
            {MANUAL_ASK}
          </button>
        </section>
      )}
    </div>
  );
}
