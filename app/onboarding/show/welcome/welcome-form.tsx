"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import OnboardingShell from "../onboarding-shell";

function looksLikeUrl(v: string): boolean {
  const trimmed = v.trim();
  if (trimmed.length === 0) return false;
  try {
    const url = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    new URL(url);
    return /\.[a-z]{2,}/i.test(url);
  } catch {
    return false;
  }
}

function normalize(v: string): string {
  const t = v.trim();
  if (!t) return "";
  return t.startsWith("http") ? t : `https://${t}`;
}

interface Looked {
  podscan_id?: string | null;
  show_name: string;
  show_description: string | null;
  show_image_url: string | null;
  show_categories: string[];
  episode_count: number | null;
  audience_size: number | null;
}

export default function WelcomeForm({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = looksLikeUrl(value);

  const handleGetStarted = async () => {
    if (!valid || submitting) return;
    setError(null);
    setSubmitting(true);

    const normalizedUrl = normalize(value);

    // 1. Save the feed URL immediately so resume works if the next step crashes.
    const putRes = await fetch("/api/show-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feed_url: normalizedUrl }),
    });
    if (!putRes.ok) {
      setError("Couldn't save your feed URL — try again.");
      setSubmitting(false);
      return;
    }

    // 2. Fire off the Podscan lookup. Failure here is non-fatal — the user
    //    lands on the confirm step and fills things in manually.
    try {
      const lookup = await fetch("/api/show-profile/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalizedUrl }),
      });
      if (lookup.ok) {
        const data = (await lookup.json()) as { found: boolean; podcast?: Looked };
        if (data.found && data.podcast) {
          await fetch("/api/show-profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data.podcast),
          });
        }
      }
    } catch {
      // swallow — confirm step handles missing data
    }

    router.push("/onboarding/show/confirm");
  };

  return (
    <OnboardingShell
      slug="welcome"
      title="Let's get your show set up."
      subtitle="Takes 3 minutes. This helps brands find you and helps us match you with the right advertisers."
      continueLabel={submitting ? "Looking up your show…" : "Get started"}
      hideBack
      onContinue={async () => {
        await handleGetStarted();
        return false; // we own the navigation
      }}
      continueDisabled={!valid || submitting}
    >
      <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-6 space-y-4 mb-6">
        <Bullet num={1} title="Drop in your RSS or Apple Podcasts link" body="We'll pull your show details automatically." />
        <Bullet num={2} title="Confirm what we found" body="Show name, image, categories, audience — edit anything that's off." />
        <Bullet num={3} title="A few quick questions" body="How often you publish, what ad formats you offer, and what you want to avoid." />
        <Bullet num={4} title="Ready for deals" body="Your profile goes live. Brands can match with you and we generate IOs and invoices automatically." />
      </div>

      <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">
        Your RSS feed or Apple Podcasts link
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        placeholder="feeds.yourshow.com/rss"
        disabled={submitting}
        className="w-full px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all disabled:opacity-60"
      />
      <p className="text-xs text-[var(--brand-text-muted)] mt-2">
        We&apos;ll pull your show details, episode count, and audience data automatically.
      </p>
      {error && (
        <p className="text-xs text-[var(--brand-error)] mt-2">{error}</p>
      )}
    </OnboardingShell>
  );
}

function Bullet({ num, title, body }: { num: number; title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-7 h-7 rounded-full bg-[var(--brand-blue)]/10 text-[var(--brand-blue)] flex items-center justify-center text-xs font-bold flex-shrink-0">
        {num}
      </div>
      <div>
        <div className="font-semibold text-[var(--brand-text)]">{title}</div>
        <div className="text-sm text-[var(--brand-text-secondary)]">{body}</div>
      </div>
    </div>
  );
}
