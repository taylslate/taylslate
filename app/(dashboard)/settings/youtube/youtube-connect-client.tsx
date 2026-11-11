"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { tokens } from "@/lib/brand/tokens";
import type { YoutubeStatus } from "@/lib/youtube-oauth/store";

const radiusStyle = { borderRadius: tokens.radius };

const ERROR_TEXT: Record<string, string> = {
  state: "That connection attempt expired. Start it again.",
  expired: "That connection attempt expired. Start it again.",
  user: "Sign in with the show account that started the connection.",
  scope: "YouTube did not grant caption access. Connect again and allow captions.",
  channel: "Connect the one YouTube channel this show uses.",
  channel_taken: "That YouTube channel is already connected to another Taylslate account.",
  denied: "YouTube access was not granted.",
  exchange: "YouTube could not complete the connection. Try again.",
};

export default function YoutubeConnectClient({
  status,
  notice,
}: {
  status: YoutubeStatus;
  notice: { connected?: boolean; error?: string | null };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const active = status.connected && status.status === "active";
  const reconnect = status.status === "reauth_required";

  const disconnect = async () => {
    setPending(true);
    setMessage(null);
    const res = await fetch("/api/youtube/disconnect", { method: "POST" });
    setPending(false);
    if (!res.ok) {
      setMessage("Could not disconnect. Try again.");
      return;
    }
    router.refresh();
  };

  return (
    <div className="max-w-2xl p-4 sm:p-8">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
        For shows
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--ts-ink-on-paper)]">
        YouTube
      </h1>
      <p className="mb-6 mt-1 text-sm text-[var(--ts-ink-muted-on-paper)]">
        Connect your channel so Taylslate can read captions and analytics for videos on your deals.
      </p>

      {notice.connected && (
        <p className="mb-4 text-sm text-[var(--ts-ink-on-paper)]">YouTube is connected.</p>
      )}
      {notice.error && (
        <p className="mb-4 text-sm text-[var(--ts-accent-text)]" role="alert">
          {ERROR_TEXT[notice.error] ?? "YouTube could not complete the connection. Try again."}
        </p>
      )}
      {message && (
        <p className="mb-4 text-sm text-[var(--ts-accent-text)]" role="alert">
          {message}
        </p>
      )}

      <section
        className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4"
        style={radiusStyle}
      >
        {active ? (
          <p className="text-sm text-[var(--ts-ink-on-paper)]">
            Connected{status.channel_title ? ` to ${status.channel_title}` : ""}.
            {status.channel_id ? ` Channel ${status.channel_id}.` : ""}
            {status.analytics_enabled
              ? " Analytics access is on."
              : " Analytics access is off. Connect again to allow it."}
          </p>
        ) : reconnect ? (
          <p className="text-sm text-[var(--ts-ink-on-paper)]">
            Reconnect. This YouTube connection needs to be granted again
            {status.channel_title ? ` for ${status.channel_title}` : ""}.
          </p>
        ) : (
          <p className="text-sm text-[var(--ts-ink-on-paper)]">No YouTube channel is connected.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          {!active && (
            <a
              href="/api/youtube/connect"
              className="inline-flex items-center bg-[var(--ts-accent)] px-4 py-2 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90"
              style={radiusStyle}
            >
              Connect YouTube
            </a>
          )}
          {(active || reconnect) && (
            <button
              type="button"
              onClick={disconnect}
              disabled={pending}
              className="inline-flex items-center border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:opacity-50"
              style={radiusStyle}
            >
              {pending ? "Disconnecting" : "Disconnect"}
            </button>
          )}
        </div>
      </section>

      <div className="mt-8 space-y-4 text-sm leading-6 text-[var(--ts-ink-muted-on-paper)]">
        <p>
          Taylslate uses YouTube API Services. By connecting a YouTube channel you also agree to the{" "}
          <a className="text-[var(--ts-accent-text)] underline" href="https://www.youtube.com/t/terms">
            YouTube Terms of Service
          </a>
          .
        </p>
        <p>
          Taylslate asks Google for two permissions. youtube.force-ssl lets us read the caption tracks of
          videos on your channel. Google does not offer a narrower permission for captions, and it also
          allows changes to your channel. Taylslate never uploads, edits, deletes, or posts anything.
          Nothing is posted or changed on YouTube. yt-analytics.readonly lets us read YouTube Analytics for
          videos on your Taylslate deals: views, estimated minutes watched, average view duration, and the
          audience retention points around the sponsor read.
        </p>
        <p>
          We store your channel ID and title. We read captions and analytics to verify that a booked sponsor
          read aired and to report delivery for that deal. Taylslate staff review sponsor-read excerpts. Brands
          do not see your captions or analytics. We do not use this Google data for advertising, we do not sell
          it, and we do not use it to train AI models or in pooled data.
        </p>
        <p>
          Caption text and the sponsor-read excerpt are deleted 30 days after we fetch them. The match result
          stays with the deal. If Google testing access lapses, or a refresh fails, reconnect here. After 30
          days without a working grant we delete the stored Google data, including the channel ID and title.
          Disconnect revokes Taylslate at Google, deletes the tokens right away, and deletes the remaining
          Google data within 7 days.
        </p>
        <p>
          Disconnect here, or remove Taylslate at{" "}
          <a
            className="text-[var(--ts-accent-text)] underline"
            href="https://security.google.com/settings/security/permissions"
          >
            https://security.google.com/settings/security/permissions
          </a>
          . Google&apos;s Privacy Policy is at{" "}
          <a className="text-[var(--ts-accent-text)] underline" href="https://policies.google.com/privacy">
            https://policies.google.com/privacy
          </a>
          . Taylslate&apos;s privacy policy is at{" "}
          <Link className="text-[var(--ts-accent-text)] underline" href="/privacy">
            /privacy
          </Link>
          .
        </p>
        <p>
          Taylslate&apos;s use and transfer to any other app of information received from Google APIs will
          adhere to the{" "}
          <a
            className="text-[var(--ts-accent-text)] underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </div>
    </div>
  );
}
