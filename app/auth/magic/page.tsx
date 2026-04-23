// Public landing page for magic-link errors and the post-send confirmation.
// Real link consumption happens at /api/auth/magic which then redirects.

"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: "This link is missing its token. Ask the brand to resend the invite.",
  invalid_or_expired:
    "This link has expired or isn't valid. Magic links are good for 24 hours — ask the brand to resend.",
  signup_failed: "We couldn't create your account. Please try again or contact support.",
  signin_failed: "We couldn't sign you in. Please try the link again.",
};

function MagicMessage() {
  const params = useSearchParams();
  const error = params.get("error");
  const sent = params.get("sent");

  if (error) {
    return (
      <>
        <h1 className="text-2xl font-bold text-[var(--brand-text)] mb-3">
          Something went wrong
        </h1>
        <p className="text-sm text-[var(--brand-text-secondary)] mb-6">
          {ERROR_MESSAGES[error] ?? "Unknown error. Please try again."}
        </p>
        <Link
          href="/"
          className="text-sm text-[var(--brand-blue)] hover:underline font-medium"
        >
          Back to home
        </Link>
      </>
    );
  }

  if (sent) {
    return (
      <>
        <h1 className="text-2xl font-bold text-[var(--brand-text)] mb-3">
          Check your email
        </h1>
        <p className="text-sm text-[var(--brand-text-secondary)] mb-2">
          We sent you a sign-in link. Click it to set up your account and respond
          to the pitch.
        </p>
        <p className="text-xs text-[var(--brand-text-muted)]">
          The link expires in 24 hours.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold text-[var(--brand-text)] mb-3">
        One sec…
      </h1>
      <p className="text-sm text-[var(--brand-text-secondary)]">
        Verifying your link.
      </p>
    </>
  );
}

export default function MagicLandingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--brand-surface)] px-4">
      <div className="w-full max-w-md text-center bg-[var(--brand-surface-elevated)] border border-[var(--brand-border)] rounded-2xl p-8">
        <Suspense
          fallback={
            <p className="text-sm text-[var(--brand-text-secondary)]">Loading…</p>
          }
        >
          <MagicMessage />
        </Suspense>
      </div>
    </div>
  );
}
