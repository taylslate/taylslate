// Public landing page for magic-link errors and the post-send confirmation.
// Real link consumption happens at /api/auth/magic which then redirects.

"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";

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
        <h1 className="text-2xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
          {ERROR_MESSAGES[error] ?? "Unknown error. Please try again."}
        </p>
        <Link
          href="/"
          className="mt-8 inline-block text-sm text-[var(--ts-accent)] hover:underline"
        >
          Back to home
        </Link>
      </>
    );
  }

  if (sent) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
          We sent you a sign-in link. Click it to set up your account and respond
          to the pitch.
        </p>
        <p className="mt-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
          The link expires in 24 hours.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">One sec…</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ts-ink-muted-on-paper)]">
        Verifying your link.
      </p>
    </>
  );
}

export default function MagicLandingPage() {
  return (
    <AuthShell>
      <div className="text-center">
        <Suspense
          fallback={
            <p className="text-sm text-[var(--ts-ink-muted-on-paper)]">
              Loading…
            </p>
          }
        >
          <MagicMessage />
        </Suspense>
      </div>
    </AuthShell>
  );
}
